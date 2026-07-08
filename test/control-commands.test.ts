import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlStatus } from "../src/control-protocol.js";

const mocks = vi.hoisted(() => ({
  sendControlRequest: vi.fn(),
}));

vi.mock("../src/control-client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/control-client.js")>();
  return {
    WorkerNotRunningError: original.WorkerNotRunningError,
    sendControlRequest: mocks.sendControlRequest,
  };
});
vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { runControlAction, runStatus, statusCommand } =
  await import("../src/control-commands.js");
const { WorkerNotRunningError } = await import("../src/control-client.js");
const { logger } = await import("../src/logger.js");

function buildStatus(overrides: Partial<ControlStatus> = {}): ControlStatus {
  return {
    version: "1.0.0",
    pid: 4242,
    startedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
    projectDir: "/srv/project",
    headless: true,
    agents: {
      monitor: {
        phase: { kind: "sleeping", until: "2026-07-08T09:15:00.000Z" },
        control: "running",
        recentOutcomes: [],
      },
      executor: {
        phase: { kind: "session", taskId: "t-1", title: "Fix", since: "x" },
        control: "running",
        recentOutcomes: [],
      },
    },
    stats: { cycles: 12, tasksSucceeded: 5, tasksFailed: 1, totalCostUsd: 1.2345 },
    taskCounts: { pending: 2, in_progress: 1, done: 5, failed: 1, cancelled: 0 },
    ...overrides,
  };
}

describe("runStatus", () => {
  let lines: string[];
  let savedExitCode: typeof process.exitCode;
  const write = (line: string) => lines.push(line);

  beforeEach(() => {
    vi.clearAllMocks();
    lines = [];
    savedExitCode = process.exitCode;
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  it("prints a human-readable summary", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true, data: buildStatus() });

    await runStatus({ write });

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(
      expect.stringContaining("brownie-"),
      { cmd: "status" },
    );
    const output = lines.join("\n");
    expect(output).toContain("brownie 1.0.0 · pid 4242 · up 1h 30m · headless");
    expect(output).toContain("project   /srv/project");
    expect(output).toContain("monitor   running  sleeping · until");
    expect(output).toContain("executor  running  session · t-1");
    expect(output).toContain(
      "tasks     pending 2 · in_progress 1 · done 5 · failed 1 · cancelled 0",
    );
    expect(output).toContain(
      "stats     cycles 12 · tasks ok 5 · tasks failed 1 · cost $1.2345",
    );
  });

  it("prints raw JSON with --json", async () => {
    const status = buildStatus();
    mocks.sendControlRequest.mockResolvedValue({ ok: true, data: status });

    await runStatus({ json: true, write });

    expect(JSON.parse(lines.join("\n"))).toEqual(status);
  });

  it("fails with exit code 1 when no worker is running", async () => {
    mocks.sendControlRequest.mockRejectedValue(new WorkerNotRunningError());

    await runStatus({ write });

    expect(logger.error).toHaveBeenCalledWith(
      "No brownie worker is running in this project.",
    );
    expect(process.exitCode).toBe(1);
    expect(lines).toEqual([]);
  });

  it("fails when the worker returns an error response", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: false, error: "broken" });

    await runStatus({ write });

    expect(logger.error).toHaveBeenCalledWith("broken");
    expect(process.exitCode).toBe(1);
  });

  it("statusCommand.run forwards the json flag", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true, data: buildStatus() });
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await (statusCommand.run as (ctx: unknown) => Promise<void>)({
        args: { json: true, _: [] },
      });
    } finally {
      stdoutWrite.mockRestore();
    }

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(expect.any(String), {
      cmd: "status",
    });
  });
});

describe("runControlAction", () => {
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    savedExitCode = process.exitCode;
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  it("pauses both agents by default", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true });

    await runControlAction("pause", undefined);

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(expect.any(String), {
      cmd: "pause",
      agent: "all",
    });
    expect(logger.success).toHaveBeenCalledWith("Pausing monitor and executor.");
  });

  it("resumes a single agent", async () => {
    mocks.sendControlRequest.mockResolvedValue({ ok: true });

    await runControlAction("resume", "monitor");

    expect(mocks.sendControlRequest).toHaveBeenCalledWith(expect.any(String), {
      cmd: "resume",
      agent: "monitor",
    });
    expect(logger.success).toHaveBeenCalledWith("Resumed monitor.");
  });

  it("rejects an unknown agent name", async () => {
    await runControlAction("pause", "summarizer");

    expect(mocks.sendControlRequest).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown agent "summarizer"'),
    );
    expect(process.exitCode).toBe(1);
  });

  it("rejects the literal all in favor of omitting the agent", async () => {
    await runControlAction("pause", "all");

    expect(mocks.sendControlRequest).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("fails with exit code 1 when no worker is running", async () => {
    mocks.sendControlRequest.mockRejectedValue(new WorkerNotRunningError());

    await runControlAction("resume", undefined);

    expect(logger.error).toHaveBeenCalledWith(
      "No brownie worker is running in this project.",
    );
    expect(process.exitCode).toBe(1);
  });
});
