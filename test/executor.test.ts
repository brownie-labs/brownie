import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskStore } from "../src/tasks.js";
import type { SessionResult, Task } from "../src/types.js";
import { UsageLimitGate } from "../src/usage-limit.js";
import { Waker } from "../src/waker.js";
import {
  buildConfig,
  createExecutorReporterSpy,
  createTaskSummarizerSpy,
  noopController,
  type ExecutorReporterSpy,
  type TaskSummarizerSpy,
} from "./helpers.js";

const mocks = vi.hoisted(() => ({
  runSession: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("../src/runner.js", () => ({ runSession: mocks.runSession }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: mocks.readFile,
}));

const { runExecutorLoop, composeTaskPrompt, isTransientFailure } =
  await import("../src/executor.js");

function task(id: string): Task {
  return {
    id,
    title: `Task ${id}`,
    description: `Description ${id}`,
    status: "pending",
    attempts: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function ok(): SessionResult {
  return { ok: true, durationMs: 0 };
}

function transientFailure(): SessionResult {
  return {
    ok: false,
    durationMs: 10,
    error: "Session ended with an error (is_error)",
    failureReason: "isError",
    resultText: "API Error: Connection closed mid-response.",
  };
}

interface FakeStore {
  store: TaskStore;
  takeNext: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
  requeue: ReturnType<typeof vi.fn>;
}

function fakeStore(queue: Task[]): FakeStore {
  const pending = [...queue];
  const takeNext = vi.fn(() => {
    const next = pending.shift();
    return Promise.resolve(next ? { ...next, attempts: next.attempts + 1 } : undefined);
  });
  const complete = vi.fn().mockResolvedValue(undefined);
  const fail = vi.fn().mockResolvedValue(undefined);
  const requeue = vi.fn().mockResolvedValue(undefined);
  return {
    store: {
      takeNext,
      complete,
      fail,
      requeue,
      pendingCount: () => pending.length,
    } as unknown as TaskStore,
    takeNext,
    complete,
    fail,
    requeue,
  };
}

describe("composeTaskPrompt", () => {
  it("appends the task block to the prompt", () => {
    const prompt = composeTaskPrompt("identity\n", task("redmine-7"));

    expect(prompt).toContain("identity");
    expect(prompt).toContain("## Task to complete");
    expect(prompt).toContain("ID: redmine-7");
    expect(prompt).toContain("Title: Task redmine-7");
    expect(prompt).toContain("Description redmine-7");
  });
});

describe("runExecutorLoop", () => {
  let spy: ExecutorReporterSpy;
  let summarizerSpy: TaskSummarizerSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    spy = createExecutorReporterSpy();
    summarizerSpy = createTaskSummarizerSpy();
    mocks.readFile.mockImplementation((path: string) =>
      Promise.resolve(path.includes("system") ? "system\n" : "identity\n"),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drains the queue sequentially and marks tasks as completed", async () => {
    const { store, complete } = fakeStore([task("a"), task("b")]);
    const waker = new Waker();
    const controller = new AbortController();
    let concurrent = 0;
    let maxConcurrent = 0;
    mocks.runSession.mockImplementation(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Promise.resolve();
      concurrent -= 1;
      return ok();
    });

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      waker,
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(2));

    expect(complete).toHaveBeenNthCalledWith(1, "a");
    expect(complete).toHaveBeenNthCalledWith(2, "b");
    expect(maxConcurrent).toBe(1);
    expect(spy.taskStarted).toHaveBeenCalledTimes(2);
    expect(spy.taskFinished).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "a", ok: true }),
    );
    expect(spy.taskFinished).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "b", ok: true }),
    );

    controller.abort();
    await promise;
  });

  it("composes the session spec: contract in the system prompt, task in the prompt, session sink", async () => {
    const { store } = fakeStore([task("x")]);
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue(ok());
    const config = buildConfig();
    config.executor = {
      ...config.executor,
      promptPath: "/x/executor.prompt.md",
      systemPromptPath: "/x/executor.system.md",
    };

    const promise = runExecutorLoop(
      config,
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() => expect(mocks.runSession).toHaveBeenCalled());
    controller.abort();
    await promise;

    const spec = mocks.runSession.mock.calls[0]?.[0] as {
      model: string;
      effort: string;
      systemPrompt: string;
      prompt: string;
      mcpConfig: string;
      jsonSchema?: string;
      events: unknown;
    };
    expect(spec.model).toBe("opus");
    expect(spec.effort).toBe("high");
    expect(spec.systemPrompt).toBe("system\n");
    expect(spec.prompt).toContain("identity");
    expect(spec.prompt).toContain("ID: x");
    expect(spec.mcpConfig).toBe('{"mcpServers":{}}');
    expect(spec.jsonSchema).toBeUndefined();
    expect(spec.events).toBe(spy.reporter.session);
  });

  it("runs a memory summary after a completed task", async () => {
    const { store, complete } = fakeStore([task("a")]);
    const controller = new AbortController();
    const result = { ...ok(), sessionId: "session-a" };
    mocks.runSession.mockResolvedValue(result);

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() => expect(summarizerSpy.summarize).toHaveBeenCalled());
    controller.abort();
    await promise;

    expect(complete).toHaveBeenCalledWith("a");
    expect(summarizerSpy.summarize).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", attempts: 1 }),
      result,
      { willRetry: false },
      controller.signal,
    );
    const finishedOrder = spy.taskFinished.mock.invocationCallOrder[0] ?? Infinity;
    const summarizeOrder =
      summarizerSpy.summarize.mock.invocationCallOrder[0] ?? -Infinity;
    expect(summarizeOrder).toBeGreaterThan(finishedOrder);
  });

  it("runs a summary with retry info after a failed task", async () => {
    const { store } = fakeStore([task("flaky")]);
    const controller = new AbortController();
    const result = { ...transientFailure(), sessionId: "session-f" };
    mocks.runSession.mockResolvedValue(result);

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() => expect(summarizerSpy.summarize).toHaveBeenCalled());
    controller.abort();
    await promise;

    expect(summarizerSpy.summarize).toHaveBeenCalledWith(
      expect.objectContaining({ id: "flaky" }),
      result,
      { willRetry: true },
      controller.signal,
    );
  });

  it("a throwing summarizer does not change task status and does not break the loop", async () => {
    const { store, complete, fail } = fakeStore([task("a"), task("b")]);
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue(ok());
    summarizerSpy.summarize.mockRejectedValue(new Error("memory failure"));

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
    controller.abort();
    await promise;

    expect(complete).toHaveBeenNthCalledWith(1, "a");
    expect(complete).toHaveBeenNthCalledWith(2, "b");
    expect(fail).not.toHaveBeenCalled();
  });

  it("a failed session marks the task as failed with the error", async () => {
    const { store, complete, fail } = fakeStore([task("bad")]);
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue({
      ok: false,
      durationMs: 10,
      error: "Process exited with code 2",
    } satisfies SessionResult);

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(fail).toHaveBeenCalledWith("bad", "Process exited with code 2"),
    );
    expect(complete).not.toHaveBeenCalled();
    expect(spy.taskFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "bad",
        ok: false,
        error: "Process exited with code 2",
      }),
    );

    controller.abort();
    await promise;
  });

  it("an exception during a task marks it as failed, the loop keeps going", async () => {
    const { store, fail, complete } = fakeStore([task("crash"), task("good")]);
    const controller = new AbortController();
    mocks.runSession.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(ok());

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("good"));

    expect(fail).toHaveBeenCalledWith("crash", "boom");
    expect(spy.taskFinished).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "crash", ok: false, error: "boom" }),
    );

    controller.abort();
    await promise;
  });

  it("with an empty queue reports waiting and wakes up on notify", async () => {
    const { store, takeNext, complete } = fakeStore([]);
    const waker = new Waker();
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue(ok());

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      waker,
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() => expect(takeNext).toHaveBeenCalledTimes(1));
    expect(mocks.runSession).not.toHaveBeenCalled();
    expect(spy.waiting).toHaveBeenCalledTimes(1);

    takeNext.mockResolvedValueOnce(task("new"));
    waker.notify();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("new"));

    controller.abort();
    await promise;
  });

  it("abort while waiting ends the loop", async () => {
    const { store, takeNext } = fakeStore([]);
    const controller = new AbortController();

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() => expect(takeNext).toHaveBeenCalledTimes(1));

    controller.abort();
    await promise;

    expect(mocks.runSession).not.toHaveBeenCalled();
    expect(spy.taskStarted).not.toHaveBeenCalled();
  });

  it("abort during a session leaves the task with an unchanged status and no result", async () => {
    const { store, complete, fail } = fakeStore([task("in-flight")]);
    const controller = new AbortController();
    mocks.runSession.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({
        ok: false,
        durationMs: 5,
        error: "Session aborted",
      } satisfies SessionResult);
    });

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await promise;

    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(spy.taskFinished).not.toHaveBeenCalled();
    expect(summarizerSpy.summarize).not.toHaveBeenCalled();
  });

  it("a transient error goes back to the queue and is retried until success", async () => {
    const takeNext = vi
      .fn()
      .mockResolvedValueOnce({ ...task("flaky"), attempts: 1 })
      .mockResolvedValueOnce({ ...task("flaky"), attempts: 2 })
      .mockResolvedValue(undefined);
    const complete = vi.fn().mockResolvedValue(undefined);
    const fail = vi.fn().mockResolvedValue(undefined);
    const requeue = vi.fn().mockResolvedValue(undefined);
    const store = { takeNext, complete, fail, requeue } as unknown as TaskStore;
    const controller = new AbortController();
    mocks.runSession.mockResolvedValueOnce(transientFailure()).mockResolvedValue(ok());

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("flaky"));

    expect(requeue).toHaveBeenCalledWith(
      "flaky",
      "Session ended with an error (is_error)",
    );
    expect(fail).not.toHaveBeenCalled();
    expect(spy.taskFinished).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        taskId: "flaky",
        ok: false,
        willRetry: true,
        attempt: 1,
        maxAttempts: 3,
      }),
    );
    expect(spy.taskFinished).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ taskId: "flaky", ok: true }),
    );

    controller.abort();
    await promise;
  });

  it("after attempts are exhausted a transient error marks the task as failed", async () => {
    const { store, fail, requeue } = fakeStore([{ ...task("stubborn"), attempts: 2 }]);
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue(transientFailure());

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(fail).toHaveBeenCalledWith(
        "stubborn",
        "Session ended with an error (is_error)",
      ),
    );

    expect(requeue).not.toHaveBeenCalled();
    expect(spy.taskFinished).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "stubborn", willRetry: false, attempt: 3 }),
    );

    controller.abort();
    await promise;
  });

  it("a permanent error is not retried", async () => {
    const { store, fail, requeue } = fakeStore([task("permanently-bad")]);
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue({
      ok: false,
      durationMs: 10,
      error: "Process exited with code 2",
      failureReason: "exit",
    } satisfies SessionResult);

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(fail).toHaveBeenCalledWith("permanently-bad", "Process exited with code 2"),
    );

    expect(requeue).not.toHaveBeenCalled();

    controller.abort();
    await promise;
  });

  it("reports backoff before retrying and waits the given time", async () => {
    vi.useFakeTimers();
    const takeNext = vi
      .fn()
      .mockResolvedValueOnce({ ...task("flaky"), attempts: 1 })
      .mockResolvedValue(undefined);
    const requeue = vi.fn().mockResolvedValue(undefined);
    const store = {
      takeNext,
      requeue,
      complete: vi.fn(),
      fail: vi.fn(),
    } as unknown as TaskStore;
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue(transientFailure());
    const config = buildConfig();
    config.executor = { ...config.executor, retryDelayMs: 5_000 };

    const promise = runExecutorLoop(
      config,
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(1);

    expect(spy.retryScheduled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "flaky" }),
      expect.any(Date),
    );
    expect(takeNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(takeNext).toHaveBeenCalledTimes(2);

    controller.abort();
    await promise;
  });

  it("a usage-limit failure releases the task and parks the loop until the reset", async () => {
    vi.useFakeTimers();
    const takeNext = vi
      .fn()
      .mockResolvedValueOnce({ ...task("limited"), attempts: 1 })
      .mockResolvedValueOnce({ ...task("limited"), attempts: 1 })
      .mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const complete = vi.fn().mockResolvedValue(undefined);
    const fail = vi.fn().mockResolvedValue(undefined);
    const requeue = vi.fn().mockResolvedValue(undefined);
    const store = {
      takeNext,
      release,
      complete,
      fail,
      requeue,
    } as unknown as TaskStore;
    const controller = new AbortController();
    const resetsAt = Math.floor(Date.now() / 1000) + 2;
    mocks.runSession
      .mockResolvedValueOnce({
        ok: false,
        durationMs: 10,
        failureReason: "isError",
        error: "Session ended with an error (is_error)",
        rateLimit: { status: "rejected", resetsAt, rateLimitType: "five_hour" },
      } satisfies SessionResult)
      .mockResolvedValue(ok());

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      noopController(),
      new UsageLimitGate(),
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(1);

    expect(release).toHaveBeenCalledWith("limited", "usage limit reached");
    expect(fail).not.toHaveBeenCalled();
    expect(requeue).not.toHaveBeenCalled();
    expect(summarizerSpy.summarize).not.toHaveBeenCalled();
    expect(spy.taskFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "limited",
        ok: false,
        willRetry: true,
        error: "usage limit reached — task requeued",
      }),
    );
    expect(spy.usageLimit).toHaveBeenCalledWith(expect.any(Date));
    expect(takeNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(takeNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(33_000);
    expect(complete).toHaveBeenCalledWith("limited");

    controller.abort();
    await promise;
  });

  it("pause while idle parks the loop and resume picks up new tasks", async () => {
    const takeNext = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(task("after-resume"))
      .mockResolvedValue(undefined);
    const complete = vi.fn().mockResolvedValue(undefined);
    const store = {
      takeNext,
      complete,
      fail: vi.fn(),
      requeue: vi.fn(),
    } as unknown as TaskStore;
    const abort = new AbortController();
    const control = noopController();
    mocks.runSession.mockResolvedValue(ok());

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      control,
      new UsageLimitGate(),
      abort.signal,
    );
    await vi.waitFor(() => expect(spy.waiting).toHaveBeenCalled());

    control.pause();
    await vi.waitFor(() => expect(control.state).toBe("paused"));
    expect(takeNext).toHaveBeenCalledTimes(1);

    control.resume();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("after-resume"));

    abort.abort();
    await promise;
  });

  it("pause during a task lets it finish and does not take the next one", async () => {
    let finishSession: (result: SessionResult) => void = () => undefined;
    mocks.runSession.mockImplementation(
      () =>
        new Promise<SessionResult>((resolvePromise) => {
          finishSession = resolvePromise;
        }),
    );
    const takeNext = vi
      .fn()
      .mockResolvedValueOnce(task("current"))
      .mockResolvedValue(task("next"));
    const complete = vi.fn().mockResolvedValue(undefined);
    const store = {
      takeNext,
      complete,
      fail: vi.fn(),
      requeue: vi.fn(),
    } as unknown as TaskStore;
    const abort = new AbortController();
    const control = noopController();

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      summarizerSpy.summarizer,
      control,
      new UsageLimitGate(),
      abort.signal,
    );
    await vi.waitFor(() => expect(mocks.runSession).toHaveBeenCalledTimes(1));

    control.pause();
    expect(control.state).toBe("pausing");
    finishSession(ok());

    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("current"));
    await vi.waitFor(() => expect(control.state).toBe("paused"));
    expect(takeNext).toHaveBeenCalledTimes(1);

    abort.abort();
    await promise;
  });
});

describe("isTransientFailure", () => {
  it("a session timeout is transient", () => {
    expect(
      isTransientFailure({ ok: false, durationMs: 1, failureReason: "timeout" }),
    ).toBe(true);
  });

  it("is_error with an API/connection error is transient", () => {
    for (const text of [
      "API Error: Connection closed mid-response.",
      "fetch failed: ECONNRESET",
      "socket hang up",
      "Overloaded, please retry",
      "429 rate limit exceeded",
    ]) {
      expect(
        isTransientFailure({
          ok: false,
          durationMs: 1,
          failureReason: "isError",
          resultText: text,
        }),
      ).toBe(true);
    }
  });

  it("is_error without a network error signature is not transient", () => {
    expect(
      isTransientFailure({
        ok: false,
        durationMs: 1,
        failureReason: "isError",
        resultText: "I cannot complete this task.",
      }),
    ).toBe(false);
  });

  it("other reasons (exit, spawn, abort) are not transient", () => {
    for (const failureReason of ["exit", "spawn", "abort"] as const) {
      expect(isTransientFailure({ ok: false, durationMs: 1, failureReason })).toBe(false);
    }
  });
});
