import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskStore } from "../src/tasks.js";
import type { SessionResult, Task } from "../src/types.js";
import { Waker } from "../src/waker.js";
import { buildConfig } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  runSession: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("../src/runner.js", () => ({ runSession: mocks.runSession }));
vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: mocks.readFile,
}));

const { runExecutorLoop, composeTaskPrompt, TASK_EXECUTION_CONTRACT } =
  await import("../src/executor.js");
const { logger } = await import("../src/logger.js");

function task(id: string): Task {
  return {
    id,
    title: `Zadanie ${id}`,
    description: `Opis ${id}`,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function ok(): SessionResult {
  return { ok: true, durationMs: 0 };
}

interface FakeStore {
  store: TaskStore;
  takeNext: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
}

function fakeStore(queue: Task[]): FakeStore {
  const pending = [...queue];
  const takeNext = vi.fn(() => Promise.resolve(pending.shift()));
  const complete = vi.fn().mockResolvedValue(undefined);
  const fail = vi.fn().mockResolvedValue(undefined);
  return {
    store: {
      takeNext,
      complete,
      fail,
      pendingCount: () => pending.length,
    } as unknown as TaskStore,
    takeNext,
    complete,
    fail,
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
  beforeEach(() => {
    vi.clearAllMocks();
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

    const promise = runExecutorLoop(buildConfig(), store, waker, controller.signal);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(2));

    expect(complete).toHaveBeenNthCalledWith(1, "a");
    expect(complete).toHaveBeenNthCalledWith(2, "b");
    expect(maxConcurrent).toBe(1);

    controller.abort();
    await promise;
  });

  it("komponuje spec sesji: kontrakt w system promptcie, zadanie w promptcie", async () => {
    const { store } = fakeStore([task("x")]);
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue(ok());
    const config = buildConfig();
    config.executor = {
      ...config.executor,
      promptPath: "/x/executor.prompt.md",
      systemPromptPath: "/x/executor.system.md",
    };

    const promise = runExecutorLoop(config, store, new Waker(), controller.signal);
    await vi.waitFor(() => expect(mocks.runSession).toHaveBeenCalled());
    controller.abort();
    await promise;

    const spec = mocks.runSession.mock.calls[0]?.[0] as {
      model: string;
      systemPrompt: string;
      prompt: string;
    };
    expect(spec.model).toBe("opus");
    expect(spec.systemPrompt).toBe(`system\n\n\n${TASK_EXECUTION_CONTRACT}`);
    expect(spec.prompt).toContain("tożsamość");
    expect(spec.prompt).toContain("ID: x");
  });

  it("nieudana sesja oznacza zadanie jako failed z błędem", async () => {
    const { store, complete, fail } = fakeStore([task("zly")]);
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue({
      ok: false,
      durationMs: 10,
      error: "Proces zakończył się kodem 2",
    } satisfies SessionResult);

    const promise = runExecutorLoop(buildConfig(), store, new Waker(), controller.signal);
    await vi.waitFor(() =>
      expect(fail).toHaveBeenCalledWith("zly", "Proces zakończył się kodem 2"),
    );
    expect(complete).not.toHaveBeenCalled();

    controller.abort();
    await promise;
  });

  it("wyjątek podczas zadania oznacza je jako failed, pętla trwa dalej", async () => {
    const { store, fail, complete } = fakeStore([task("crash"), task("dobre")]);
    const controller = new AbortController();
    mocks.runSession.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(ok());

    const promise = runExecutorLoop(buildConfig(), store, new Waker(), controller.signal);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("dobre"));

    expect(fail).toHaveBeenCalledWith("crash", "boom");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("wyjątek"),
      expect.anything(),
    );

    controller.abort();
    await promise;
  });

  it("przy pustej kolejce czeka i budzi się po notify", async () => {
    const { store, takeNext, complete } = fakeStore([]);
    const waker = new Waker();
    const controller = new AbortController();
    mocks.runSession.mockResolvedValue(ok());

    const promise = runExecutorLoop(buildConfig(), store, waker, controller.signal);
    await vi.waitFor(() => expect(takeNext).toHaveBeenCalledTimes(1));
    expect(mocks.runSession).not.toHaveBeenCalled();

    takeNext.mockResolvedValueOnce(task("nowe"));
    waker.notify();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("nowe"));

    controller.abort();
    await promise;
  });

  it("abort podczas oczekiwania kończy pętlę", async () => {
    const { store, takeNext } = fakeStore([]);
    const controller = new AbortController();

    const promise = runExecutorLoop(buildConfig(), store, new Waker(), controller.signal);
    await vi.waitFor(() => expect(takeNext).toHaveBeenCalledTimes(1));

    controller.abort();
    await promise;

    expect(mocks.runSession).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Egzekutor zatrzymany"),
    );
  });

  it("abort w trakcie sesji zostawia zadanie bez zmiany statusu", async () => {
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

    const promise = runExecutorLoop(buildConfig(), store, new Waker(), controller.signal);
    await promise;

    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("przerwane"));
  });
});
