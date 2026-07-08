import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendControlRequest, WorkerNotRunningError } from "../src/control-client.js";
import type { ControlStatus } from "../src/control-protocol.js";
import {
  AlreadyRunningError,
  startControlServer,
  type ControlServerHandle,
} from "../src/control-server.js";

function buildStatus(overrides: Partial<ControlStatus> = {}): ControlStatus {
  return {
    version: "1.0.0",
    pid: 4242,
    startedAt: "2026-07-08T08:00:00.000Z",
    projectDir: "/srv/project",
    headless: true,
    agents: {
      monitor: { phase: { kind: "starting" }, control: "running", recentOutcomes: [] },
      executor: { phase: { kind: "waiting" }, control: "running", recentOutcomes: [] },
    },
    stats: { cycles: 0, tasksSucceeded: 0, tasksFailed: 0, totalCostUsd: 0 },
    taskCounts: { pending: 0, in_progress: 0, done: 0, failed: 0, cancelled: 0 },
    ...overrides,
  };
}

let socketCounter = 0;

function tempSocketPath(): string {
  socketCounter += 1;
  return join(
    tmpdir(),
    `brownie-test-${String(process.pid)}-${String(socketCounter)}.sock`,
  );
}

describe("startControlServer", () => {
  let socketPath: string;
  let abort: AbortController;
  let handles: ControlServerHandle[];

  function controls() {
    return {
      monitor: { pause: vi.fn(), resume: vi.fn() },
      executor: { pause: vi.fn(), resume: vi.fn() },
    };
  }

  async function startServer(
    overrides: {
      buildStatus?: () => ControlStatus;
      controls?: ReturnType<typeof controls>;
    } = {},
  ) {
    const deps = {
      socketPath,
      buildStatus: overrides.buildStatus ?? (() => buildStatus()),
      controls: overrides.controls ?? controls(),
      signal: abort.signal,
    };
    const handle = await startControlServer(deps);
    handles.push(handle);
    return { handle, deps };
  }

  beforeEach(() => {
    socketPath = tempSocketPath();
    abort = new AbortController();
    handles = [];
  });

  afterEach(async () => {
    for (const handle of handles) await handle.close();
  });

  it("answers a status request with the built status", async () => {
    await startServer({ buildStatus: () => buildStatus({ pid: 777 }) });

    const response = await sendControlRequest(socketPath, { cmd: "status" });

    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({ pid: 777, version: "1.0.0" });
  });

  it("routes pause and resume to the right controllers", async () => {
    const ctrl = controls();
    await startServer({ controls: ctrl });

    await sendControlRequest(socketPath, { cmd: "pause", agent: "monitor" });
    await sendControlRequest(socketPath, { cmd: "resume", agent: "executor" });
    await sendControlRequest(socketPath, { cmd: "pause", agent: "all" });

    expect(ctrl.monitor.pause).toHaveBeenCalledTimes(2);
    expect(ctrl.executor.pause).toHaveBeenCalledTimes(1);
    expect(ctrl.executor.resume).toHaveBeenCalledTimes(1);
    expect(ctrl.monitor.resume).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized request without crashing", async () => {
    await startServer();

    const socketModule = await import("node:net");
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = socketModule.connect(socketPath);
      let buffer = "";
      socket.on("error", reject);
      socket.on("connect", () => socket.write("definitely not json\n"));
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (buffer.includes("\n")) {
          socket.destroy();
          resolve(buffer);
        }
      });
    });

    expect(JSON.parse(raw.trim())).toEqual({
      ok: false,
      error: "Unrecognized control request.",
    });

    const response = await sendControlRequest(socketPath, { cmd: "status" });
    expect(response.ok).toBe(true);
  });

  it("removes a stale socket file before listening", async () => {
    await writeFile(socketPath, "", "utf8");

    await startServer();

    const response = await sendControlRequest(socketPath, { cmd: "status" });
    expect(response.ok).toBe(true);
  });

  it("refuses to start when another worker owns the socket", async () => {
    await startServer({ buildStatus: () => buildStatus({ pid: 12345 }) });

    await expect(
      startControlServer({
        socketPath,
        buildStatus: () => buildStatus(),
        controls: controls(),
        signal: abort.signal,
      }),
    ).rejects.toThrow(AlreadyRunningError);
    await expect(
      startControlServer({
        socketPath,
        buildStatus: () => buildStatus(),
        controls: controls(),
        signal: abort.signal,
      }),
    ).rejects.toThrow("pid 12345");
  });

  it("close() removes the socket and stops answering", async () => {
    const { handle } = await startServer();

    await handle.close();

    expect(existsSync(socketPath)).toBe(false);
    await expect(sendControlRequest(socketPath, { cmd: "status" })).rejects.toThrow(
      WorkerNotRunningError,
    );
  });

  it("closes when the abort signal fires", async () => {
    await startServer();

    abort.abort();
    await vi.waitFor(() => {
      expect(existsSync(socketPath)).toBe(false);
    });
  });
});
