import { join } from "node:path";
import { loadWorkerConfig } from "./config.js";
import { buildControlStatus } from "./control-protocol.js";
import { startControlServer } from "./control-server.js";
import { AgentController } from "./control.js";
import { runExecutorLoop } from "./executor.js";
import { loadGlobalConfig } from "./global-config.js";
import { compactFields } from "./headless/events.js";
import type { HeadlessLogFormat } from "./headless/format.js";
import { createHeadlessReporters } from "./headless/reporters.js";
import { createHeadlessSink } from "./headless/sink.js";
import { teeReporter } from "./headless/tee.js";
import { logger } from "./logger.js";
import { MemoryStore } from "./memory/store.js";
import { SessionSummarizer } from "./memory/summarizer.js";
import { runMonitorLoop } from "./monitor.js";
import { controlSocketPath, packageVersion } from "./paths.js";
import { ensureReady } from "./preflight.js";
import { createPromptFileAccess } from "./prompt-files.js";
import { SessionLog, teeSession } from "./session-log.js";
import { createSettingsController } from "./settings-controller.js";
import { abortOnSignals } from "./shutdown.js";
import { WorkerStatusStore } from "./status.js";
import { TaskStore } from "./tasks.js";
import { runAutoUpdateLoop } from "./update/auto-update.js";
import { defaultUpdateDeps } from "./update/updater.js";
import { mountDashboard } from "./ui/mount.js";
import { UsageLimitGate } from "./usage-limit.js";
import { Waker } from "./waker.js";

export interface StartWorkerOptions {
  headless?: boolean | undefined;
  logFormat?: HeadlessLogFormat | undefined;
  verbose?: boolean | undefined;
  stdout?: { write(chunk: string): unknown } | undefined;
}

export async function startWorker(options: StartWorkerOptions = {}): Promise<void> {
  let config;
  let store;
  let memory;
  try {
    const paths = await ensureReady();
    config = await loadWorkerConfig({}, paths);
    store = await TaskStore.open(config.tasksFilePath);
    memory = MemoryStore.open(config.memoryDbPath);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  const status = new WorkerStatusStore();
  store.onChange((tasks) => status.setTasks(tasks));
  status.setTasks(store.list());

  const interactive =
    process.stdin.isTTY && process.stdout.isTTY && options.headless !== true;
  const headlessEmit = interactive
    ? null
    : createHeadlessSink({
        format: options.logFormat ?? "pretty",
        out: options.stdout ?? process.stdout,
      });
  const headlessReporters =
    headlessEmit === null
      ? null
      : createHeadlessReporters(headlessEmit, { verbose: options.verbose });

  let shutdownSignal: string | undefined;
  const signal = abortOnSignals((signalName) => {
    shutdownSignal = signalName;
    status.shutdownRequested(signalName);
  });
  const waker = new Waker();
  const limitGate = new UsageLimitGate();
  const initialControlState = interactive ? "paused" : "running";
  const monitorControl = new AgentController((state) => {
    status.setControl("monitor", state);
    headlessEmit?.({
      level: "info",
      agent: "monitor",
      event: "control.changed",
      fields: { state },
    });
  }, initialControlState);
  const executorControl = new AgentController((state) => {
    status.setControl("executor", state);
    headlessEmit?.({
      level: "info",
      agent: "executor",
      event: "control.changed",
      fields: { state },
    });
  }, initialControlState);
  status.setControl("monitor", initialControlState);
  status.setControl("executor", initialControlState);

  let controlServer;
  try {
    controlServer = await startControlServer({
      socketPath: controlSocketPath(config.cwd),
      controls: { monitor: monitorControl, executor: executorControl },
      buildStatus: () => {
        status.flush();
        return buildControlStatus({
          snapshot: status.getSnapshot(),
          version: packageVersion(),
          pid: process.pid,
          projectDir: config.cwd,
          headless: !interactive,
        });
      },
      signal,
    });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : err);
    memory.close();
    status.dispose();
    process.exitCode = 1;
    return;
  }

  const settings = createSettingsController({
    config,
    settingsFile: config.settingsFilePath,
  });
  const prompts = createPromptFileAccess({
    monitor: config.monitor.promptPath,
    executor: config.executor.promptPath,
  });
  const dashboard = interactive
    ? mountDashboard({
        store: status,
        config,
        version: packageVersion(),
        controls: { monitor: monitorControl, executor: executorControl },
        tasks: store,
        memory,
        settings,
        prompts,
        waker,
        requestExit: () => process.kill(process.pid, "SIGINT"),
      })
    : null;

  const monitorLog = new SessionLog(join(config.logsDir, "monitor"));
  const executorLog = new SessionLog(join(config.logsDir, "executor"));
  const summarizerLog = new SessionLog(join(config.logsDir, "summarizer"));

  const monitorReporter =
    headlessReporters === null
      ? status.monitor
      : teeReporter(status.monitor, headlessReporters.monitor);
  const executorReporter =
    headlessReporters === null
      ? status.executor
      : teeReporter(status.executor, headlessReporters.executor);
  const summaryReporter =
    headlessReporters === null
      ? status.executor
      : teeReporter(status.executor, headlessReporters.summarizer);

  const summarizer = new SessionSummarizer({
    command: config.command,
    summarizer: config.summarizer,
    streamPartial: config.streamPartial,
    cwd: config.cwd,
    store: memory,
    resolveLogPath: async (sessionId) => {
      await executorLog.flush();
      return executorLog.pathFor(sessionId);
    },
    reporter: teeSession(summaryReporter, summarizerLog.sink),
    limitGate,
  });

  headlessEmit?.({
    level: "info",
    event: "worker.started",
    fields: {
      version: packageVersion(),
      pid: process.pid,
      projectDir: config.cwd,
    },
  });

  const globalConfig = await loadGlobalConfig();

  let loopError: unknown;
  try {
    await Promise.all([
      runMonitorLoop(
        config,
        store,
        waker,
        teeSession(monitorReporter, monitorLog.sink),
        monitorControl,
        limitGate,
        signal,
      ),
      runExecutorLoop(
        config,
        store,
        waker,
        teeSession(executorReporter, executorLog.sink),
        summarizer,
        executorControl,
        limitGate,
        signal,
      ),
      runAutoUpdateLoop({
        globalConfig,
        deps: defaultUpdateDeps(),
        setUpdateStatus: (info) => status.setUpdateStatus(info),
        emit: headlessEmit,
        signal,
      }),
    ]);
  } catch (err) {
    loopError = err;
  } finally {
    await controlServer.close();
    await Promise.all([monitorLog.close(), executorLog.close(), summarizerLog.close()]);
    dashboard?.unmount();
    await dashboard?.waitUntilExit();
    headlessEmit?.({
      level: "info",
      event: "worker.stopped",
      fields: compactFields({ signal: shutdownSignal }),
    });
    memory.close();
    status.dispose();
  }

  if (loopError !== undefined) {
    logger.error(loopError instanceof Error ? loopError.message : loopError);
    process.exitCode = 1;
  }
}
