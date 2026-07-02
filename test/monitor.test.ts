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

const { runMonitorLoop } = await import("../src/monitor.js");
const { logger } = await import("../src/logger.js");
const { TASK_REPORT_CONTRACT } = await import("../src/report.js");

const INTERVAL = 300_000;

function report(...ids: string[]): string {
  return JSON.stringify({
    tasks: ids.map((id) => ({ id, title: `Zadanie ${id}`, description: "" })),
  });
}

function ok(resultText?: string): SessionResult {
  return { ok: true, durationMs: 0, resultText };
}

function fakeStore(addTasks = vi.fn()): { store: TaskStore; addTasks: typeof addTasks } {
  addTasks.mockImplementation((tasks: Task[]) =>
    Promise.resolve(
      tasks.map((task) => ({ ...task, status: "pending" }) as unknown as Task),
    ),
  );
  return { store: { addTasks } as unknown as TaskStore, addTasks };
}

describe("runMonitorLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.readFile.mockImplementation((path: string) =>
      Promise.resolve(path.includes("system") ? "system\n" : "prompt\n"),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dokleja kontrakt raportu do system promptu i przekazuje prompt", async () => {
    mocks.runSession.mockResolvedValue(ok(report()));
    const { store } = fakeStore();
    const controller = new AbortController();
    const config = buildConfig({
      monitor: {
        ...buildConfig().monitor,
        promptPath: "/x/monitor.prompt.md",
        systemPromptPath: "/x/monitor.system.md",
      },
    });

    const promise = runMonitorLoop(config, store, new Waker(), controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;

    const spec = mocks.runSession.mock.calls[0]?.[0] as {
      systemPrompt: string;
      prompt: string;
      model: string;
    };
    expect(spec.systemPrompt).toBe(`system\n\n\n${TASK_REPORT_CONTRACT}`);
    expect(spec.prompt).toBe("prompt\n");
    expect(spec.model).toBe("haiku");
  });

  it("dodaje zadania z raportu i budzi egzekutora", async () => {
    mocks.runSession.mockResolvedValue(ok(report("redmine-1")));
    const { store, addTasks } = fakeStore();
    const waker = new Waker();
    const notify = vi.spyOn(waker, "notify");
    const controller = new AbortController();

    const promise = runMonitorLoop(buildConfig(), store, waker, controller.signal);
    await vi.advanceTimersByTimeAsync(1);

    expect(addTasks).toHaveBeenCalledWith([
      { id: "redmine-1", title: "Zadanie redmine-1", description: "" },
    ]);
    expect(notify).toHaveBeenCalledTimes(1);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });

  it("nie budzi egzekutora, gdy wszystkie zadania to duplikaty", async () => {
    mocks.runSession.mockResolvedValue(ok(report("znane")));
    const addTasks = vi.fn().mockResolvedValue([]);
    const store = { addTasks } as unknown as TaskStore;
    const waker = new Waker();
    const notify = vi.spyOn(waker, "notify");
    const controller = new AbortController();

    const promise = runMonitorLoop(buildConfig(), store, waker, controller.signal);
    await vi.advanceTimersByTimeAsync(1);

    expect(addTasks).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining("pominięte duplikaty: 1"),
    );

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });

  it("niepoprawny raport loguje błąd, pomija cykl i kontynuuje pętlę", async () => {
    mocks.runSession
      .mockResolvedValueOnce(ok("bełkot bez json"))
      .mockResolvedValue(ok(report()));
    const { store, addTasks } = fakeStore();
    const controller = new AbortController();

    const promise = runMonitorLoop(buildConfig(), store, new Waker(), controller.signal);
    await vi.advanceTimersByTimeAsync(1);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("niepoprawny raport"),
    );
    expect(addTasks).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(mocks.runSession).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });

  it("brak resultText traktuje jak niepoprawny raport", async () => {
    mocks.runSession.mockResolvedValue(ok(undefined));
    const { store, addTasks } = fakeStore();
    const controller = new AbortController();

    const promise = runMonitorLoop(buildConfig(), store, new Waker(), controller.signal);
    await vi.advanceTimersByTimeAsync(1);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("niepoprawny raport"),
    );
    expect(addTasks).not.toHaveBeenCalled();

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });

  it("nieudana sesja nie parsuje raportu, pętla trwa dalej", async () => {
    mocks.runSession
      .mockResolvedValueOnce({
        ok: false,
        durationMs: 100,
        error: "Przekroczono limit czasu sesji",
        resultText: report("nie-powinno-trafic"),
      } satisfies SessionResult)
      .mockResolvedValue(ok(report()));
    const { store, addTasks } = fakeStore();
    const controller = new AbortController();

    const promise = runMonitorLoop(buildConfig(), store, new Waker(), controller.signal);
    await vi.advanceTimersByTimeAsync(1);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("niepowodzenie"));
    expect(addTasks).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(mocks.runSession).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });

  it("uruchamia kolejny cykl po upływie interwału", async () => {
    mocks.runSession.mockResolvedValue(ok(report()));
    const { store } = fakeStore();
    const controller = new AbortController();

    const promise = runMonitorLoop(buildConfig(), store, new Waker(), controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.runSession).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(mocks.runSession).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });

  it("przy przekroczonym interwale kolejny cykl startuje natychmiast", async () => {
    mocks.runSession.mockImplementation(
      () =>
        new Promise<SessionResult>((res) =>
          setTimeout(() => res(ok(report())), INTERVAL + 1000),
        ),
    );
    const { store } = fakeStore();
    const controller = new AbortController();

    const promise = runMonitorLoop(buildConfig(), store, new Waker(), controller.signal);

    await vi.advanceTimersByTimeAsync(INTERVAL + 1000);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("natychmiast"));
    expect(mocks.runSession).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL + 1000);
    await promise;
  });

  it("abort w trakcie sesji przerywa pętlę bez parsowania", async () => {
    const controller = new AbortController();
    const { store, addTasks } = fakeStore();
    mocks.runSession.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(ok(report("po-abort")));
    });

    const promise = runMonitorLoop(buildConfig(), store, new Waker(), controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(mocks.runSession).toHaveBeenCalledTimes(1);
    expect(addTasks).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("przerwany"));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Monitor zatrzymany"),
    );
  });

  it("poza godzinami pracy monitor czeka i budzi się w oknie", async () => {
    vi.setSystemTime(new Date("2026-07-01T06:00:00"));
    mocks.runSession.mockResolvedValue(ok(report()));
    const { store } = fakeStore();
    const controller = new AbortController();
    const base = buildConfig();
    const config = buildConfig({
      monitor: {
        ...base.monitor,
        schedule: { startMinute: 480, endMinute: 1080, days: [1, 2, 3, 4, 5] },
      },
    });

    const promise = runMonitorLoop(config, store, new Waker(), controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.runSession).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Poza godzinami pracy"),
    );

    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(mocks.runSession).toHaveBeenCalledTimes(1);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });

  it("wyjątek z cyklu jest łapany, pętla trwa dalej", async () => {
    mocks.runSession
      .mockRejectedValueOnce(new Error("crash"))
      .mockResolvedValue(ok(report()));
    const { store } = fakeStore();
    const controller = new AbortController();

    const promise = runMonitorLoop(buildConfig(), store, new Waker(), controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("wyjątek"),
      expect.anything(),
    );

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(mocks.runSession).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });
});
