import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskStore } from "../src/tasks.js";
import type { SessionResult, Task } from "../src/types.js";
import { Waker } from "../src/waker.js";
import {
  buildConfig,
  createExecutorReporterSpy,
  type ExecutorReporterSpy,
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

const {
  runExecutorLoop,
  composeTaskPrompt,
  isTransientFailure,
  TASK_EXECUTION_CONTRACT,
} = await import("../src/executor.js");

function task(id: string): Task {
  return {
    id,
    title: `Zadanie ${id}`,
    description: `Opis ${id}`,
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
    error: "Sesja zakończona błędem (is_error)",
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
  it("dokleja blok zadania do promptu", () => {
    const prompt = composeTaskPrompt("tożsamość\n", task("redmine-7"));

    expect(prompt).toContain("tożsamość");
    expect(prompt).toContain("## Zadanie do wykonania");
    expect(prompt).toContain("ID: redmine-7");
    expect(prompt).toContain("Tytuł: Zadanie redmine-7");
    expect(prompt).toContain("Opis redmine-7");
  });
});

describe("runExecutorLoop", () => {
  let spy: ExecutorReporterSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    spy = createExecutorReporterSpy();
    mocks.readFile.mockImplementation((path: string) =>
      Promise.resolve(path.includes("system") ? "system\n" : "tożsamość\n"),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drenuje kolejkę sekwencyjnie i oznacza zadania jako wykonane", async () => {
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

  it("komponuje spec sesji: kontrakt w system promptcie, zadanie w promptcie, sink sesji", async () => {
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
      events: unknown;
    };
    expect(spec.model).toBe("opus");
    expect(spec.effort).toBe("high");
    expect(spec.systemPrompt).toBe(`system\n\n\n${TASK_EXECUTION_CONTRACT}`);
    expect(spec.prompt).toContain("tożsamość");
    expect(spec.prompt).toContain("ID: x");
    expect(spec.events).toBe(spy.reporter.session);
  });

  it("nieudana sesja oznacza zadanie jako failed z błędem", async () => {
    const { store, complete, fail } = fakeStore([task("zly")]);
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue({
      ok: false,
      durationMs: 10,
      error: "Proces zakończył się kodem 2",
    } satisfies SessionResult);

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(fail).toHaveBeenCalledWith("zly", "Proces zakończył się kodem 2"),
    );
    expect(complete).not.toHaveBeenCalled();
    expect(spy.taskFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "zly",
        ok: false,
        error: "Proces zakończył się kodem 2",
      }),
    );

    controller.abort();
    await promise;
  });

  it("wyjątek podczas zadania oznacza je jako failed, pętla trwa dalej", async () => {
    const { store, fail, complete } = fakeStore([task("crash"), task("dobre")]);
    const controller = new AbortController();
    mocks.runSession.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(ok());

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      controller.signal,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("dobre"));

    expect(fail).toHaveBeenCalledWith("crash", "boom");
    expect(spy.taskFinished).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "crash", ok: false, error: "boom" }),
    );

    controller.abort();
    await promise;
  });

  it("przy pustej kolejce raportuje oczekiwanie i budzi się po notify", async () => {
    const { store, takeNext, complete } = fakeStore([]);
    const waker = new Waker();
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue(ok());

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      waker,
      spy.reporter,
      controller.signal,
    );
    await vi.waitFor(() => expect(takeNext).toHaveBeenCalledTimes(1));
    expect(mocks.runSession).not.toHaveBeenCalled();
    expect(spy.waiting).toHaveBeenCalledTimes(1);

    takeNext.mockResolvedValueOnce(task("nowe"));
    waker.notify();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("nowe"));

    controller.abort();
    await promise;
  });

  it("abort podczas oczekiwania kończy pętlę", async () => {
    const { store, takeNext } = fakeStore([]);
    const controller = new AbortController();

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      controller.signal,
    );
    await vi.waitFor(() => expect(takeNext).toHaveBeenCalledTimes(1));

    controller.abort();
    await promise;

    expect(mocks.runSession).not.toHaveBeenCalled();
    expect(spy.taskStarted).not.toHaveBeenCalled();
  });

  it("abort w trakcie sesji zostawia zadanie bez zmiany statusu i bez wyniku", async () => {
    const { store, complete, fail } = fakeStore([task("w-trakcie")]);
    const controller = new AbortController();
    mocks.runSession.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({
        ok: false,
        durationMs: 5,
        error: "Sesja przerwana",
      } satisfies SessionResult);
    });

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      controller.signal,
    );
    await promise;

    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(spy.taskFinished).not.toHaveBeenCalled();
  });

  it("błąd przejściowy wraca do kolejki i jest ponawiany aż do sukcesu", async () => {
    const takeNext = vi
      .fn()
      .mockResolvedValueOnce({ ...task("chwiejne"), attempts: 1 })
      .mockResolvedValueOnce({ ...task("chwiejne"), attempts: 2 })
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
      controller.signal,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("chwiejne"));

    expect(requeue).toHaveBeenCalledWith(
      "chwiejne",
      "Sesja zakończona błędem (is_error)",
    );
    expect(fail).not.toHaveBeenCalled();
    expect(spy.taskFinished).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        taskId: "chwiejne",
        ok: false,
        willRetry: true,
        attempt: 1,
        maxAttempts: 3,
      }),
    );
    expect(spy.taskFinished).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ taskId: "chwiejne", ok: true }),
    );

    controller.abort();
    await promise;
  });

  it("po wyczerpaniu prób błąd przejściowy oznacza zadanie jako failed", async () => {
    const { store, fail, requeue } = fakeStore([{ ...task("uparte"), attempts: 2 }]);
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue(transientFailure());

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(fail).toHaveBeenCalledWith("uparte", "Sesja zakończona błędem (is_error)"),
    );

    expect(requeue).not.toHaveBeenCalled();
    expect(spy.taskFinished).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "uparte", willRetry: false, attempt: 3 }),
    );

    controller.abort();
    await promise;
  });

  it("błąd trwały nie jest ponawiany", async () => {
    const { store, fail, requeue } = fakeStore([task("trwale-zle")]);
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue({
      ok: false,
      durationMs: 10,
      error: "Proces zakończył się kodem 2",
      failureReason: "exit",
    } satisfies SessionResult);

    const promise = runExecutorLoop(
      buildConfig(),
      store,
      new Waker(),
      spy.reporter,
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(fail).toHaveBeenCalledWith("trwale-zle", "Proces zakończył się kodem 2"),
    );

    expect(requeue).not.toHaveBeenCalled();

    controller.abort();
    await promise;
  });

  it("przed ponowieniem raportuje backoff i czeka zadany czas", async () => {
    vi.useFakeTimers();
    const takeNext = vi
      .fn()
      .mockResolvedValueOnce({ ...task("chwiejne"), attempts: 1 })
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
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(1);

    expect(spy.retryScheduled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "chwiejne" }),
      expect.any(Date),
    );
    expect(takeNext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(takeNext).toHaveBeenCalledTimes(2);

    controller.abort();
    await promise;
  });
});

describe("isTransientFailure", () => {
  it("timeout sesji jest przejściowy", () => {
    expect(
      isTransientFailure({ ok: false, durationMs: 1, failureReason: "timeout" }),
    ).toBe(true);
  });

  it("is_error z błędem API/połączenia jest przejściowy", () => {
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

  it("is_error bez sygnatury błędu sieciowego nie jest przejściowy", () => {
    expect(
      isTransientFailure({
        ok: false,
        durationMs: 1,
        failureReason: "isError",
        resultText: "Nie mogę wykonać tego zadania.",
      }),
    ).toBe(false);
  });

  it("inne przyczyny (exit, spawn, abort) nie są przejściowe", () => {
    for (const failureReason of ["exit", "spawn", "abort"] as const) {
      expect(isTransientFailure({ ok: false, durationMs: 1, failureReason })).toBe(false);
    }
  });
});
