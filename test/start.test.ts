import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConfig, createTempDir, removeTempDir } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  ensureReady: vi.fn(),
  loadWorkerConfig: vi.fn(),
  runMonitorLoop: vi.fn(),
  runExecutorLoop: vi.fn(),
  abortOnSignals: vi.fn(),
  taskStoreOpen: vi.fn(),
}));

vi.mock("../src/preflight.js", () => ({ ensureReady: mocks.ensureReady }));
vi.mock("../src/config.js", () => ({ loadWorkerConfig: mocks.loadWorkerConfig }));
vi.mock("../src/monitor.js", () => ({ runMonitorLoop: mocks.runMonitorLoop }));
vi.mock("../src/executor.js", () => ({ runExecutorLoop: mocks.runExecutorLoop }));
vi.mock("../src/shutdown.js", () => ({ abortOnSignals: mocks.abortOnSignals }));
vi.mock("../src/tasks.js", () => ({ TaskStore: { open: mocks.taskStoreOpen } }));
vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { startCommand } = await import("../src/start.js");
const { Waker } = await import("../src/waker.js");
const { logger } = await import("../src/logger.js");

function runStart(envFile?: string): Promise<void> {
  return (startCommand.run as (ctx: unknown) => Promise<void>)({
    args: { "env-file": envFile },
  });
}

function verifiedPaths(dir: string) {
  return {
    monitor: {
      promptPath: join(dir, "monitor.prompt.md"),
      systemPromptPath: join(dir, "monitor.system.md"),
    },
    executor: {
      promptPath: join(dir, "executor.prompt.md"),
      systemPromptPath: join(dir, "executor.system.md"),
    },
  };
}

describe("startCommand", () => {
  let dir: string;
  let savedExitCode: typeof process.exitCode;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await createTempDir();
    savedExitCode = process.exitCode;
  });

  afterEach(async () => {
    process.exitCode = savedExitCode;
    await removeTempDir(dir);
  });

  it("przechodzi preflight, buduje config, tworzy cwd, otwiera magazyn i startuje obie pętle", async () => {
    const paths = verifiedPaths(dir);
    const cwd = join(dir, "ws");
    const config = buildConfig({ cwd, tasksFilePath: join(dir, "data", "tasks.json") });
    const signal = new AbortController().signal;
    const store = { pendingCount: () => 0 };
    mocks.ensureReady.mockResolvedValue(paths);
    mocks.loadWorkerConfig.mockResolvedValue(config);
    mocks.abortOnSignals.mockReturnValue(signal);
    mocks.taskStoreOpen.mockResolvedValue(store);
    mocks.runMonitorLoop.mockResolvedValue(undefined);
    mocks.runExecutorLoop.mockResolvedValue(undefined);

    await runStart("./inny.env");

    expect(mocks.ensureReady).toHaveBeenCalledWith("./inny.env");
    expect(mocks.loadWorkerConfig).toHaveBeenCalledWith("./inny.env", paths);
    expect(existsSync(cwd)).toBe(true);
    expect(mocks.taskStoreOpen).toHaveBeenCalledWith(config.tasksFilePath);
    expect(mocks.runMonitorLoop).toHaveBeenCalledWith(
      config,
      store,
      expect.any(Waker),
      signal,
    );
    expect(mocks.runExecutorLoop).toHaveBeenCalledWith(
      config,
      store,
      expect.any(Waker),
      signal,
    );
    const monitorWaker = mocks.runMonitorLoop.mock.calls[0]?.[2] as unknown;
    const executorWaker = mocks.runExecutorLoop.mock.calls[0]?.[2] as unknown;
    expect(monitorWaker).toBe(executorWaker);
    expect(process.exitCode).toBe(savedExitCode);
  });

  it("błąd preflight: loguje, ustawia exitCode=1 i nie startuje pętli", async () => {
    mocks.ensureReady.mockRejectedValue(new Error("Preflight nieudany"));

    await runStart();

    expect(logger.error).toHaveBeenCalledWith("Preflight nieudany");
    expect(process.exitCode).toBe(1);
    expect(mocks.loadWorkerConfig).not.toHaveBeenCalled();
    expect(mocks.runMonitorLoop).not.toHaveBeenCalled();
    expect(mocks.runExecutorLoop).not.toHaveBeenCalled();
  });

  it("błąd ładowania konfiguracji: loguje, ustawia exitCode=1 i nie startuje pętli", async () => {
    mocks.ensureReady.mockResolvedValue(verifiedPaths(dir));
    mocks.loadWorkerConfig.mockRejectedValue(
      new Error("Nieprawidłowa konfiguracja (.env)"),
    );

    await runStart();

    expect(logger.error).toHaveBeenCalledWith("Nieprawidłowa konfiguracja (.env)");
    expect(process.exitCode).toBe(1);
    expect(mocks.runMonitorLoop).not.toHaveBeenCalled();
  });

  it("uszkodzony magazyn zadań: loguje, ustawia exitCode=1 i nie startuje pętli", async () => {
    mocks.ensureReady.mockResolvedValue(verifiedPaths(dir));
    mocks.loadWorkerConfig.mockResolvedValue(buildConfig({ cwd: join(dir, "ws") }));
    mocks.taskStoreOpen.mockRejectedValue(
      new Error("Uszkodzony plik magazynu zadań (x)"),
    );

    await runStart();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Uszkodzony plik magazynu zadań"),
    );
    expect(process.exitCode).toBe(1);
    expect(mocks.runMonitorLoop).not.toHaveBeenCalled();
    expect(mocks.runExecutorLoop).not.toHaveBeenCalled();
  });
});
