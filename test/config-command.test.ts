import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runConfigure: vi.fn(),
  startWorker: vi.fn(),
}));

vi.mock("../src/configure.js", () => ({ runConfigure: mocks.runConfigure }));
vi.mock("../src/start.js", () => ({ startWorker: mocks.startWorker }));
vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { configCommand } = await import("../src/config-command.js");
const { logger } = await import("../src/logger.js");

function runConfig(): Promise<void> {
  return (configCommand.run as (ctx: unknown) => Promise<void>)({ args: { _: [] } });
}

describe("configCommand", () => {
  let savedExitCode: typeof process.exitCode;
  let stdinTty: boolean;
  let stdoutTty: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    savedExitCode = process.exitCode;
    stdinTty = process.stdin.isTTY;
    stdoutTty = process.stdout.isTTY;
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    process.stdin.isTTY = stdinTty;
    process.stdout.isTTY = stdoutTty;
  });

  it("runs the configuration wizard and does not start the worker", async () => {
    mocks.runConfigure.mockResolvedValue(true);

    await runConfig();

    expect(mocks.runConfigure).toHaveBeenCalledTimes(1);
    expect(mocks.startWorker).not.toHaveBeenCalled();
  });

  it("also finishes cleanly when the wizard is cancelled", async () => {
    mocks.runConfigure.mockResolvedValue(false);

    await runConfig();

    expect(mocks.runConfigure).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(savedExitCode);
  });

  it("refuses to run without an interactive terminal", async () => {
    process.stdin.isTTY = false;

    await runConfig();

    expect(mocks.runConfigure).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "brownie config requires an interactive terminal.",
    );
    expect(process.exitCode).toBe(1);
  });
});
