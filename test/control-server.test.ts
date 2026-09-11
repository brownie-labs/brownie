import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendControlRequest, WorkerNotRunningError } from "../src/control-client.js";
import type { ControlStatus, WorkerIdentity } from "../src/control-protocol.js";
import {
  AlreadyRunningError,
  startControlServer,
  type ControlServerDeps,
  type ControlServerHandle,
} from "../src/control-server.js";
import type { Task } from "../src/types.js";

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    title: "Fix the bug",
    description: "details",
    status: "pending",
    attempts: 0,
    createdAt: "2026-07-08T08:00:00.000Z",
    updatedAt: "2026-07-08T08:00:00.000Z",
    ...overrides,
  };
}

function fakeDeps() {
  return {
    tasks: {
      list: vi
        .fn()
        .mockReturnValue([buildTask(), buildTask({ id: "t-2", status: "failed" })]),
      retry: vi.fn().mockResolvedValue(true),
      cancel: vi.fn().mockResolvedValue(true),
      addTasks: vi
        .fn()
        .mockImplementation((tasks: Task[]) =>
          Promise.resolve(tasks.map((task) => buildTask({ ...task, status: "pending" }))),
        ),
    },
    memory: {
      search: vi.fn().mockReturnValue([]),
      recent: vi.fn().mockReturnValue([]),
    },
    settings: {
      current: vi.fn().mockResolvedValue({ streamPartial: true }),
      patch: vi.fn().mockResolvedValue({ streamPartial: false }),
    },
    prompts: {
      read: vi.fn().mockResolvedValue("watch the pipelines"),
      write: vi.fn().mockResolvedValue(undefined),
    },
    waker: { notify: vi.fn() },
  };
}

type FakeDeps = ReturnType<typeof fakeDeps>;

async function rawRequest(socketPath: string, payload: string): Promise<string> {
  const socketModule = await import("node:net");
  return new Promise<string>((resolve, reject) => {
    const socket = socketModule.connect(socketPath);
    let buffer = "";
    socket.on("error", reject);
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("\n")) {
        socket.destroy();
        resolve(buffer);
      }
    });
  });
}

function buildIdentity(overrides: Partial<WorkerIdentity> = {}): WorkerIdentity {
  return {
    version: "1.0.0",
    claudeVersion: "2.1.268",
    nodeVersion: "22.16.0",
    pid: 4242,
    startedAt: "2026-07-08T08:00:00.000Z",
    projectDir: "/srv/project",
    authKind: "oauth",
    ...overrides,
  };
}

function buildStatus(overrides: Partial<ControlStatus> = {}): ControlStatus {
  return {
    ...buildIdentity(),
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

  interface DepsOverrides {
    identity?: WorkerIdentity;
    buildStatus?: () => ControlStatus;
    controls?: ReturnType<typeof controls>;
    fakes?: FakeDeps;
  }

  function fullDeps(overrides: DepsOverrides = {}): ControlServerDeps & FakeDeps {
    return {
      socketPath,
      identity: overrides.identity ?? buildIdentity(),
      buildStatus: overrides.buildStatus ?? (() => buildStatus()),
      controls: overrides.controls ?? controls(),
      ...(overrides.fakes ?? fakeDeps()),
      signal: abort.signal,
    };
  }

  async function startServer(overrides: DepsOverrides = {}) {
    const deps = fullDeps(overrides);
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
    if (response.ok) expect(response.data).toMatchObject({ pid: 777, version: "1.0.0" });
  });

  it("answers a version request with the worker identity alone", async () => {
    const identity = buildIdentity({ pid: 777, claudeVersion: "2.1.300" });
    await startServer({ identity });

    const response = await sendControlRequest(socketPath, { cmd: "version" });

    expect(response).toEqual({ ok: true, data: identity });
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

    const raw = await rawRequest(socketPath, "definitely not json\n");

    expect(JSON.parse(raw.trim())).toEqual({
      ok: false,
      error: "Unrecognized control request.",
    });

    const response = await sendControlRequest(socketPath, { cmd: "status" });
    expect(response.ok).toBe(true);
  });

  it("explains an invalid payload and answers only once per connection", async () => {
    await startServer();

    const raw = await rawRequest(socketPath, '{"cmd":"tasks.add"}\n{"cmd":"status"}\n');

    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      ok: false,
      error: expect.stringMatching(/^Invalid tasks.add request: description/) as string,
    });
  });

  it("refuses an oversized request", async () => {
    await startServer();

    const raw = await rawRequest(
      socketPath,
      `{"cmd":"prompt.set","content":"${"x".repeat(1_100_000)}`,
    );

    expect(JSON.parse(raw.trim())).toEqual({
      ok: false,
      error: "Control request too large.",
    });
  });

  it("serves settings.get and settings.patch through the controller", async () => {
    const { deps } = await startServer();

    const current = await sendControlRequest(socketPath, { cmd: "settings.get" });
    const patched = await sendControlRequest(socketPath, {
      cmd: "settings.patch",
      patch: { monitor: { intervalMinutes: 5 } },
    });

    expect(current).toEqual({ ok: true, data: { streamPartial: true } });
    expect(deps.settings.patch).toHaveBeenCalledWith({ monitor: { intervalMinutes: 5 } });
    expect(patched).toEqual({ ok: true, data: { streamPartial: false } });
  });

  it("maps a rejected settings patch to an error and keeps serving", async () => {
    const fakes = fakeDeps();
    fakes.settings.patch.mockRejectedValue(
      new Error(
        "Invalid configuration (.brownie/settings.json):\n  - monitor.intervalMinutes: bad",
      ),
    );
    await startServer({ fakes });

    const response = await sendControlRequest(socketPath, {
      cmd: "settings.patch",
      patch: { monitor: { intervalMinutes: -1 } },
    });

    expect(response).toEqual({
      ok: false,
      error: expect.stringContaining("monitor.intervalMinutes") as string,
    });
    const status = await sendControlRequest(socketPath, { cmd: "status" });
    expect(status.ok).toBe(true);
  });

  it("lists tasks with and without a status filter", async () => {
    await startServer();

    const all = await sendControlRequest(socketPath, { cmd: "tasks.list" });
    const failed = await sendControlRequest(socketPath, {
      cmd: "tasks.list",
      status: "failed",
    });

    expect(all.ok && all.data.map((task) => task.id)).toEqual(["t-1", "t-2"]);
    expect(failed.ok && failed.data.map((task) => task.id)).toEqual(["t-2"]);
  });

  it("adds a task from a description, generating id and title, and wakes the executor", async () => {
    const { deps } = await startServer();

    const response = await sendControlRequest(socketPath, {
      cmd: "tasks.add",
      description: "Rotate the API key\nbefore Friday",
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.id).toMatch(/^manual-/);
      expect(response.data.title).toBe("Rotate the API key");
      expect(response.data.description).toBe("Rotate the API key\nbefore Friday");
    }
    expect(deps.waker.notify).toHaveBeenCalledTimes(1);
  });

  it("adds a task with an explicit id and title", async () => {
    const { deps } = await startServer();

    await sendControlRequest(socketPath, {
      cmd: "tasks.add",
      description: "Do the thing",
      id: "ci-42",
      title: "Custom",
    });

    expect(deps.tasks.addTasks).toHaveBeenCalledWith([
      { id: "ci-42", title: "Custom", description: "Do the thing" },
    ]);
  });

  it("reports a duplicate task id without waking the executor", async () => {
    const fakes = fakeDeps();
    fakes.tasks.addTasks.mockResolvedValue([]);
    await startServer({ fakes });

    const response = await sendControlRequest(socketPath, {
      cmd: "tasks.add",
      description: "Again",
      id: "ci-42",
    });

    expect(response).toEqual({ ok: false, error: 'Task "ci-42" already exists.' });
    expect(fakes.waker.notify).not.toHaveBeenCalled();
  });

  it("retries and cancels tasks, waking the executor only on a successful retry", async () => {
    const fakes = fakeDeps();
    fakes.tasks.retry.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    fakes.tasks.cancel.mockResolvedValue(false);
    await startServer({ fakes });

    const retried = await sendControlRequest(socketPath, {
      cmd: "tasks.retry",
      id: "t-2",
    });
    const notRetried = await sendControlRequest(socketPath, {
      cmd: "tasks.retry",
      id: "x",
    });
    const cancelled = await sendControlRequest(socketPath, {
      cmd: "tasks.cancel",
      id: "x",
    });

    expect(retried).toEqual({ ok: true, data: true });
    expect(notRetried).toEqual({ ok: true, data: false });
    expect(cancelled).toEqual({ ok: true, data: false });
    expect(fakes.tasks.retry).toHaveBeenCalledWith("t-2");
    expect(fakes.tasks.cancel).toHaveBeenCalledWith("x");
    expect(fakes.waker.notify).toHaveBeenCalledTimes(1);
  });

  it("searches memory with the requested and the default limit", async () => {
    const { deps } = await startServer();

    await sendControlRequest(socketPath, {
      cmd: "memory.search",
      query: "deploy",
      limit: 5,
    });
    await sendControlRequest(socketPath, { cmd: "memory.recent" });

    expect(deps.memory.search).toHaveBeenCalledWith("deploy", 5);
    expect(deps.memory.recent).toHaveBeenCalledWith(10);
  });

  it("reads and writes prompts", async () => {
    const { deps } = await startServer();
    const content = `# Executor\n${"line\n".repeat(40_000)}`;

    const read = await sendControlRequest(socketPath, {
      cmd: "prompt.get",
      agent: "monitor",
    });
    const written = await sendControlRequest(socketPath, {
      cmd: "prompt.set",
      agent: "executor",
      content,
    });

    expect(read).toEqual({
      ok: true,
      data: { agent: "monitor", content: "watch the pipelines" },
    });
    expect(written).toEqual({ ok: true });
    expect(deps.prompts.write).toHaveBeenCalledWith("executor", content);
  });

  it("explains a missing prompt file", async () => {
    const fakes = fakeDeps();
    fakes.prompts.read.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    await startServer({ fakes });

    const response = await sendControlRequest(socketPath, {
      cmd: "prompt.get",
      agent: "executor",
    });

    expect(response).toEqual({
      ok: false,
      error: "Prompt file for executor is missing — run brownie init.",
    });
  });

  it("removes a stale socket file before listening", async () => {
    await writeFile(socketPath, "", "utf8");

    await startServer();

    const response = await sendControlRequest(socketPath, { cmd: "status" });
    expect(response.ok).toBe(true);
  });

  it("creates the socket directory when it is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brownie-socket-dir-"));
    socketPath = join(dir, "nested", "control.sock");

    try {
      await startServer();

      const response = await sendControlRequest(socketPath, { cmd: "status" });
      expect(response.ok).toBe(true);
    } finally {
      for (const handle of handles) await handle.close();
      handles = [];
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("explains a socket that cannot be opened", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brownie-socket-dir-"));
    const blocker = join(dir, "not-a-directory");
    await writeFile(blocker, "", "utf8");
    socketPath = join(blocker, "control.sock");

    try {
      await expect(startServer()).rejects.toThrow(
        /Cannot open the control socket .*control\.sock .*BROWNIE_CONTROL_SOCKET/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to start when another worker owns the socket", async () => {
    await startServer({ buildStatus: () => buildStatus({ pid: 12345 }) });

    await expect(startControlServer(fullDeps())).rejects.toThrow(AlreadyRunningError);
    await expect(startControlServer(fullDeps())).rejects.toThrow("pid 12345");
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
