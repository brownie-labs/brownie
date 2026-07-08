import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StartWorkerOptions } from "../src/start.js";
import type { ExecutorReporter, MonitorReporter } from "../src/status.js";
import { buildConfig, createTempDir, removeTempDir } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  ensureReady: vi.fn(),
  loadWorkerConfig: vi.fn(),
  runMonitorLoop: vi.fn(),
  runExecutorLoop: vi.fn(),
  abortOnSignals: vi.fn(),
  taskStoreOpen: vi.fn(),
  memoryStoreOpen: vi.fn(),
  memoryStoreClose: vi.fn(),
  mountDashboard: vi.fn(),
  dashboardUnmount: vi.fn(),
  dashboardWaitUntilExit: vi.fn(),
  startControlServer: vi.fn(),
  controlServerClose: vi.fn(),
}));

vi.mock("../src/preflight.js", () => ({ ensureReady: mocks.ensureReady }));
vi.mock("../src/config.js", () => ({ loadWorkerConfig: mocks.loadWorkerConfig }));
vi.mock("../src/monitor.js", () => ({ runMonitorLoop: mocks.runMonitorLoop }));
vi.mock("../src/executor.js", () => ({ runExecutorLoop: mocks.runExecutorLoop }));
vi.mock("../src/shutdown.js", () => ({ abortOnSignals: mocks.abortOnSignals }));
vi.mock("../src/tasks.js", () => ({ TaskStore: { open: mocks.taskStoreOpen } }));
vi.mock("../src/memory/store.js", () => ({
  MemoryStore: { open: mocks.memoryStoreOpen },
}));
vi.mock("../src/ui/mount.js", () => ({ mountDashboard: mocks.mountDashboard }));
vi.mock("../src/control-server.js", () => ({
  startControlServer: mocks.startControlServer,
}));
vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { startWorker } = await import("../src/start.js");
const { AgentController } = await import("../src/control.js");
const { Waker } = await import("../src/waker.js");
const { WorkerStatusStore } = await import("../src/status.js");
const { UsageLimitGate } = await import("../src/usage-limit.js");
const { SessionSummarizer } = await import("../src/memory/summarizer.js");
const { logger } = await import("../src/logger.js");

function runStart(options?: StartWorkerOptions): Promise<void> {
  return startWorker(options);
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

interface JsonSink {
  write(chunk: string): boolean;
  events(): Record<string, unknown>[];
}

function jsonSink(): JsonSink {
  const lines: string[] = [];
  return {
    write(chunk: string) {
      lines.push(chunk);
      return true;
    },
    events: () =>
      lines.map((line) => JSON.parse(line.trimEnd()) as Record<string, unknown>),
  };
}

describe("startWorker", () => {
  let dir: string;
  let savedExitCode: typeof process.exitCode;
  let stdinTty: boolean;
  let stdoutTty: boolean;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.dashboardWaitUntilExit.mockResolvedValue(undefined);
    mocks.mountDashboard.mockReturnValue({
      unmount: mocks.dashboardUnmount,
      waitUntilExit: mocks.dashboardWaitUntilExit,
    });
    mocks.memoryStoreOpen.mockReturnValue({ close: mocks.memoryStoreClose });
    mocks.controlServerClose.mockResolvedValue(undefined);
    mocks.startControlServer.mockResolvedValue({ close: mocks.controlServerClose });
    dir = await createTempDir();
    savedExitCode = process.exitCode;
    stdinTty = process.stdin.isTTY;
    stdoutTty = process.stdout.isTTY;
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
  });

  afterEach(async () => {
    process.exitCode = savedExitCode;
    process.stdin.isTTY = stdinTty;
    process.stdout.isTTY = stdoutTty;
    await removeTempDir(dir);
  });

  function stubHappyPath(config = buildConfig()) {
    const signal = new AbortController().signal;
    const store = { pendingCount: () => 0, list: () => [], onChange: vi.fn() };
    mocks.ensureReady.mockResolvedValue(verifiedPaths(dir));
    mocks.loadWorkerConfig.mockResolvedValue(config);
    mocks.abortOnSignals.mockReturnValue(signal);
    mocks.taskStoreOpen.mockResolvedValue(store);
    mocks.runMonitorLoop.mockResolvedValue(undefined);
    mocks.runExecutorLoop.mockResolvedValue(undefined);
    return { signal, store, config };
  }

  it("passes preflight, builds config, opens the store and starts both loops", async () => {
    const config = buildConfig({
      cwd: dir,
      tasksFilePath: join(dir, ".brownie", "data", "tasks.json"),
    });
    const { signal, store } = stubHappyPath(config);

    await runStart({ stdout: jsonSink() });

    expect(mocks.ensureReady).toHaveBeenCalledWith();
    expect(mocks.loadWorkerConfig).toHaveBeenCalledWith({}, verifiedPaths(dir));
    expect(mocks.taskStoreOpen).toHaveBeenCalledWith(config.tasksFilePath);
    expect(mocks.runMonitorLoop).toHaveBeenCalledWith(
      config,
      store,
      expect.any(Waker),
      expect.objectContaining({ cycleStarted: expect.any(Function) as unknown }),
      expect.any(AgentController),
      expect.any(UsageLimitGate),
      signal,
    );
    expect(mocks.memoryStoreOpen).toHaveBeenCalledWith(config.memoryDbPath);
    expect(mocks.runExecutorLoop).toHaveBeenCalledWith(
      config,
      store,
      expect.any(Waker),
      expect.objectContaining({ taskStarted: expect.any(Function) as unknown }),
      expect.any(SessionSummarizer),
      expect.any(AgentController),
      expect.any(UsageLimitGate),
      signal,
    );
    const monitorController = mocks.runMonitorLoop.mock.calls[0]?.[4] as InstanceType<
      typeof AgentController
    >;
    const executorController = mocks.runExecutorLoop.mock.calls[0]?.[5] as InstanceType<
      typeof AgentController
    >;
    expect(monitorController).not.toBe(executorController);
    expect(monitorController.state).toBe("running");
    expect(executorController.state).toBe("running");
    const monitorWaker = mocks.runMonitorLoop.mock.calls[0]?.[2] as unknown;
    const executorWaker = mocks.runExecutorLoop.mock.calls[0]?.[2] as unknown;
    expect(monitorWaker).toBe(executorWaker);
    const monitorGate = mocks.runMonitorLoop.mock.calls[0]?.[5] as unknown;
    const executorGate = mocks.runExecutorLoop.mock.calls[0]?.[6] as unknown;
    expect(monitorGate).toBe(executorGate);
    expect(store.onChange).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.memoryStoreClose).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(savedExitCode);
    expect(mocks.startControlServer).toHaveBeenCalledWith(
      expect.objectContaining({
        socketPath: expect.stringContaining("brownie-") as unknown,
        controls: { monitor: monitorController, executor: executorController },
        buildStatus: expect.any(Function) as unknown,
        signal,
      }),
    );
    expect(mocks.controlServerClose).toHaveBeenCalledTimes(1);
    const serverDeps = mocks.startControlServer.mock.calls[0]?.[0] as {
      buildStatus: () => Record<string, unknown>;
    };
    expect(serverDeps.buildStatus()).toMatchObject({
      pid: process.pid,
      projectDir: dir,
      headless: true,
      taskCounts: expect.objectContaining({ pending: 0 }) as unknown,
    });
  });

  it("exits with code 1 when another worker already owns the control socket", async () => {
    stubHappyPath(buildConfig({ cwd: dir }));
    mocks.startControlServer.mockRejectedValue(
      new Error("brownie is already running in this project (pid 123)."),
    );

    await runStart({ stdout: jsonSink() });

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("already running"));
    expect(process.exitCode).toBe(1);
    expect(mocks.runMonitorLoop).not.toHaveBeenCalled();
    expect(mocks.runExecutorLoop).not.toHaveBeenCalled();
    expect(mocks.memoryStoreClose).toHaveBeenCalledTimes(1);
  });

  it("headless without a TTY: skips the dashboard and logs the worker lifecycle", async () => {
    stubHappyPath(buildConfig({ cwd: dir }));
    const sink = jsonSink();

    await runStart({ logFormat: "json", stdout: sink });

    expect(mocks.mountDashboard).not.toHaveBeenCalled();
    expect(mocks.dashboardUnmount).not.toHaveBeenCalled();
    const events = sink.events();
    expect(events[0]).toMatchObject({
      event: "worker.started",
      pid: process.pid,
      projectDir: dir,
    });
    expect(typeof events[0]?.version).toBe("string");
    expect(events.at(-1)).toMatchObject({ event: "worker.stopped" });
    expect(events.at(-1)).not.toHaveProperty("signal");
  });

  it("headless: tees loop reporters into the status store and the log sink", async () => {
    stubHappyPath(buildConfig({ cwd: dir }));
    const sink = jsonSink();

    await runStart({ logFormat: "json", stdout: sink });

    const monitorReporter = mocks.runMonitorLoop.mock.calls[0]?.[3] as MonitorReporter;
    const executorReporter = mocks.runExecutorLoop.mock.calls[0]?.[3] as ExecutorReporter;
    monitorReporter.cycleStarted(9);
    executorReporter.waiting();

    const events = sink.events();
    expect(events).toContainEqual(
      expect.objectContaining({ event: "cycle.started", agent: "monitor", cycle: 9 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ event: "executor.waiting", agent: "executor" }),
    );
  });

  it("headless: emits control.changed when a controller changes state", async () => {
    stubHappyPath(buildConfig({ cwd: dir }));
    const sink = jsonSink();

    await runStart({ logFormat: "json", stdout: sink });

    const monitorController = mocks.runMonitorLoop.mock.calls[0]?.[4] as InstanceType<
      typeof AgentController
    >;
    monitorController.pause();

    expect(sink.events()).toContainEqual(
      expect.objectContaining({
        event: "control.changed",
        agent: "monitor",
        state: "pausing",
      }),
    );
  });

  it("the --headless flag forces headless mode even with a TTY", async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    stubHappyPath(buildConfig({ cwd: dir }));
    const sink = jsonSink();

    await runStart({ headless: true, logFormat: "json", stdout: sink });

    expect(mocks.mountDashboard).not.toHaveBeenCalled();
    const monitorController = mocks.runMonitorLoop.mock.calls[0]?.[4] as InstanceType<
      typeof AgentController
    >;
    expect(monitorController.state).toBe("running");
    expect(sink.events()[0]).toMatchObject({ event: "worker.started" });
  });

  it("interactive: mounts the dashboard, boots paused and stays silent on stdout", async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    const { store } = stubHappyPath(buildConfig({ cwd: dir }));
    const sink = jsonSink();

    await runStart({ stdout: sink });

    expect(sink.events()).toEqual([]);
    const monitorController = mocks.runMonitorLoop.mock.calls[0]?.[4] as InstanceType<
      typeof AgentController
    >;
    const executorController = mocks.runExecutorLoop.mock.calls[0]?.[5] as InstanceType<
      typeof AgentController
    >;
    expect(monitorController.state).toBe("paused");
    expect(executorController.state).toBe("paused");
    expect(mocks.mountDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        store: expect.any(WorkerStatusStore) as unknown,
        version: expect.any(String) as unknown,
        controls: {
          monitor: expect.any(AgentController) as unknown,
          executor: expect.any(AgentController) as unknown,
        },
        tasks: store,
        settings: expect.objectContaining({
          setModel: expect.any(Function) as unknown,
        }) as unknown,
        prompts: expect.objectContaining({
          read: expect.any(Function) as unknown,
          write: expect.any(Function) as unknown,
        }) as unknown,
        waker: expect.any(Waker) as unknown,
        requestExit: expect.any(Function) as unknown,
      }),
    );
    const mountProps = mocks.mountDashboard.mock.calls[0]?.[0] as {
      store: InstanceType<typeof WorkerStatusStore>;
      controls: { monitor: unknown; executor: unknown };
      version: string;
    };
    expect(mountProps.controls.monitor).toBe(monitorController);
    expect(mountProps.controls.executor).toBe(executorController);
    expect(mountProps.version).not.toBe("unknown");
    mountProps.store.flush();
    expect(mountProps.store.getSnapshot().monitor.control).toBe("paused");
    expect(mountProps.store.getSnapshot().executor.control).toBe("paused");
    const asRecord = (value: unknown): Record<string, unknown> =>
      value as Record<string, unknown>;
    const monitorReporter = asRecord(mocks.runMonitorLoop.mock.calls[0]?.[3]);
    const executorReporter = asRecord(mocks.runExecutorLoop.mock.calls[0]?.[3]);
    const monitor = asRecord(mountProps.store.monitor);
    const executor = asRecord(mountProps.store.executor);
    expect(monitorReporter.cycleStarted).toBe(monitor.cycleStarted);
    expect(monitorReporter.session).not.toBe(monitor.session);
    expect(executorReporter.taskStarted).toBe(executor.taskStarted);
    expect(executorReporter.session).not.toBe(executor.session);
    expect(mocks.dashboardUnmount).toHaveBeenCalledTimes(1);
    expect(mocks.dashboardWaitUntilExit).toHaveBeenCalledTimes(1);
  });

  it("loop error: unmounts the dashboard, logs and sets exitCode=1", async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    stubHappyPath(buildConfig({ cwd: dir }));
    mocks.runMonitorLoop.mockRejectedValue(new Error("loop failure"));

    await runStart();

    expect(mocks.dashboardUnmount).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("loop failure");
    expect(process.exitCode).toBe(1);
  });

  it("preflight error: logs, sets exitCode=1 and does not start the loops", async () => {
    mocks.ensureReady.mockRejectedValue(new Error("Preflight failed"));

    await runStart();

    expect(logger.error).toHaveBeenCalledWith("Preflight failed");
    expect(process.exitCode).toBe(1);
    expect(mocks.loadWorkerConfig).not.toHaveBeenCalled();
    expect(mocks.runMonitorLoop).not.toHaveBeenCalled();
    expect(mocks.runExecutorLoop).not.toHaveBeenCalled();
  });

  it("config loading error: logs, sets exitCode=1 and does not start the loops", async () => {
    mocks.ensureReady.mockResolvedValue(verifiedPaths(dir));
    mocks.loadWorkerConfig.mockRejectedValue(
      new Error("Invalid configuration (.brownie/settings.json)"),
    );

    await runStart();

    expect(logger.error).toHaveBeenCalledWith(
      "Invalid configuration (.brownie/settings.json)",
    );
    expect(process.exitCode).toBe(1);
    expect(mocks.runMonitorLoop).not.toHaveBeenCalled();
  });

  it("corrupted task store: logs, sets exitCode=1 and does not start the loops", async () => {
    mocks.ensureReady.mockResolvedValue(verifiedPaths(dir));
    mocks.loadWorkerConfig.mockResolvedValue(buildConfig({ cwd: dir }));
    mocks.taskStoreOpen.mockRejectedValue(new Error("Corrupted task store file (x)"));

    await runStart();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Corrupted task store file"),
    );
    expect(process.exitCode).toBe(1);
    expect(mocks.runMonitorLoop).not.toHaveBeenCalled();
    expect(mocks.runExecutorLoop).not.toHaveBeenCalled();
  });
});
