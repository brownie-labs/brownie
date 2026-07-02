import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConfig, createTempDir, removeTempDir } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  ensureReady: vi.fn(),
  loadWorkerConfig: vi.fn(),
  runScheduler: vi.fn(),
  abortOnSignals: vi.fn(),
}));

vi.mock("../src/preflight.js", () => ({ ensureReady: mocks.ensureReady }));
vi.mock("../src/config.js", () => ({ loadWorkerConfig: mocks.loadWorkerConfig }));
vi.mock("../src/scheduler.js", () => ({ runScheduler: mocks.runScheduler }));
vi.mock("../src/shutdown.js", () => ({ abortOnSignals: mocks.abortOnSignals }));
vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { startCommand } = await import("../src/start.js");
const { logger } = await import("../src/logger.js");

function runStart(envFile?: string): Promise<void> {
  return (startCommand.run as (ctx: unknown) => Promise<void>)({
    args: { "env-file": envFile },
  });
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

  it("przechodzi preflight, buduje config, tworzy cwd i startuje scheduler", async () => {
    const paths = {
      promptPath: join(dir, "prompt.md"),
      systemPromptPath: join(dir, "system.md"),
    };
    const cwd = join(dir, "ws");
    const config = buildConfig({ cwd });
    const signal = new AbortController().signal;
    mocks.ensureReady.mockResolvedValue(paths);
    mocks.loadWorkerConfig.mockResolvedValue(config);
    mocks.abortOnSignals.mockReturnValue(signal);
    mocks.runScheduler.mockResolvedValue(undefined);

    await runStart("./inny.env");

    expect(mocks.ensureReady).toHaveBeenCalledWith("./inny.env");
    expect(mocks.loadWorkerConfig).toHaveBeenCalledWith("./inny.env", paths);
    expect(existsSync(cwd)).toBe(true);
    expect(mocks.runScheduler).toHaveBeenCalledWith(config, signal);
    expect(process.exitCode).toBe(savedExitCode);
  });

  it("błąd preflight: loguje, ustawia exitCode=1 i nie startuje schedulera", async () => {
    mocks.ensureReady.mockRejectedValue(new Error("Preflight nieudany"));

    await runStart();

    expect(logger.error).toHaveBeenCalledWith("Preflight nieudany");
    expect(process.exitCode).toBe(1);
    expect(mocks.loadWorkerConfig).not.toHaveBeenCalled();
    expect(mocks.runScheduler).not.toHaveBeenCalled();
  });

  it("błąd ładowania konfiguracji: loguje, ustawia exitCode=1 i nie startuje schedulera", async () => {
    mocks.ensureReady.mockResolvedValue({
      promptPath: join(dir, "prompt.md"),
      systemPromptPath: join(dir, "system.md"),
    });
    mocks.loadWorkerConfig.mockRejectedValue(
      new Error("Nieprawidłowa konfiguracja (.env)"),
    );

    await runStart();

    expect(logger.error).toHaveBeenCalledWith("Nieprawidłowa konfiguracja (.env)");
    expect(process.exitCode).toBe(1);
    expect(mocks.runScheduler).not.toHaveBeenCalled();
  });
});
