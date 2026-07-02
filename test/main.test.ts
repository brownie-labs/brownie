import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isConfigured: vi.fn(),
  runConfigure: vi.fn(),
  startWorker: vi.fn(),
}));

vi.mock("../src/configure.js", () => ({
  isConfigured: mocks.isConfigured,
  runConfigure: mocks.runConfigure,
}));
vi.mock("../src/start.js", () => ({ startWorker: mocks.startWorker }));
vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { mainCommand, runBrownie } = await import("../src/main.js");
const { logger } = await import("../src/logger.js");

describe("runBrownie", () => {
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    savedExitCode = process.exitCode;
    mocks.startWorker.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  it("starts the worker directly when everything is configured", async () => {
    mocks.isConfigured.mockReturnValue(true);

    await runBrownie({ envFile: "./custom.env", interactive: true });

    expect(mocks.isConfigured).toHaveBeenCalledWith("./custom.env");
    expect(mocks.runConfigure).not.toHaveBeenCalled();
    expect(mocks.startWorker).toHaveBeenCalledWith("./custom.env");
  });

  it("runs the wizard before starting on first run", async () => {
    const order: string[] = [];
    mocks.isConfigured.mockReturnValue(false);
    mocks.runConfigure.mockImplementation(() => {
      order.push("configure");
      return Promise.resolve(true);
    });
    mocks.startWorker.mockImplementation(() => {
      order.push("start");
      return Promise.resolve();
    });

    await runBrownie({ envFile: "./custom.env", interactive: true });

    expect(mocks.runConfigure).toHaveBeenCalledWith("./custom.env");
    expect(order).toEqual(["configure", "start"]);
  });

  it("does not start when the wizard is cancelled on first run", async () => {
    mocks.isConfigured.mockReturnValue(false);
    mocks.runConfigure.mockResolvedValue(false);

    await runBrownie({ interactive: true });

    expect(mocks.startWorker).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(savedExitCode);
  });

  it("configure flag forces the wizard even when configured", async () => {
    mocks.isConfigured.mockReturnValue(true);
    mocks.runConfigure.mockResolvedValue(true);

    await runBrownie({ configure: true, interactive: true });

    expect(mocks.runConfigure).toHaveBeenCalledTimes(1);
    expect(mocks.startWorker).toHaveBeenCalledTimes(1);
  });

  it("configure flag with a declined overwrite starts with the existing config", async () => {
    mocks.isConfigured.mockReturnValue(true);
    mocks.runConfigure.mockResolvedValue(false);

    await runBrownie({ configure: true, interactive: true });

    expect(mocks.startWorker).toHaveBeenCalledTimes(1);
  });

  it("skips the wizard without a TTY and lets preflight report the problem", async () => {
    mocks.isConfigured.mockReturnValue(false);

    await runBrownie({ interactive: false });

    expect(mocks.runConfigure).not.toHaveBeenCalled();
    expect(mocks.startWorker).toHaveBeenCalledTimes(1);
  });

  it("rejects a legacy subcommand with exit code 1", async () => {
    mocks.isConfigured.mockReturnValue(true);

    await runBrownie({ positionals: ["start"], interactive: true });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown command "start"'),
    );
    expect(process.exitCode).toBe(1);
    expect(mocks.runConfigure).not.toHaveBeenCalled();
    expect(mocks.startWorker).not.toHaveBeenCalled();
  });

  it("detects interactivity from the terminal when not overridden", async () => {
    mocks.isConfigured.mockReturnValue(false);
    const stdinTty = process.stdin.isTTY;
    const stdoutTty = process.stdout.isTTY;
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;

    try {
      await runBrownie();
    } finally {
      process.stdin.isTTY = stdinTty;
      process.stdout.isTTY = stdoutTty;
    }

    expect(mocks.runConfigure).not.toHaveBeenCalled();
    expect(mocks.startWorker).toHaveBeenCalledTimes(1);
  });
});

describe("mainCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startWorker.mockResolvedValue(undefined);
  });

  it("passes parsed args to the worker flow", async () => {
    mocks.isConfigured.mockReturnValue(true);

    await (mainCommand.run as (ctx: unknown) => Promise<void>)({
      args: { env: "./custom.env", configure: false, _: [] },
    });

    expect(mocks.startWorker).toHaveBeenCalledWith("./custom.env");
  });
});
