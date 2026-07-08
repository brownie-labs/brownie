import { join } from "node:path";
import { loadWorkerConfig } from "./config.js";
import { AgentController } from "./control.js";
import { runExecutorLoop } from "./executor.js";
import { logger } from "./logger.js";
import { MemoryStore } from "./memory/store.js";
import { SessionSummarizer } from "./memory/summarizer.js";
import { runMonitorLoop } from "./monitor.js";
import { packageVersion } from "./paths.js";
import { ensureReady } from "./preflight.js";
import { createPromptFileAccess } from "./prompt-files.js";
import { SessionLog, teeSession } from "./session-log.js";
import { createSettingsController } from "./settings-controller.js";
import { abortOnSignals } from "./shutdown.js";
import { WorkerStatusStore } from "./status.js";
import { TaskStore } from "./tasks.js";
import { mountDashboard } from "./ui/mount.js";
import { UsageLimitGate } from "./usage-limit.js";
import { Waker } from "./waker.js";

export async function startWorker(): Promise<void> {
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

  const signal = abortOnSignals((signalName) => status.shutdownRequested(signalName));
  const waker = new Waker();
  const limitGate = new UsageLimitGate();
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const initialControlState = interactive ? "paused" : "running";
  const monitorControl = new AgentController((state) => {
    status.setControl("monitor", state);
  }, initialControlState);
  const executorControl = new AgentController((state) => {
    status.setControl("executor", state);
  }, initialControlState);
  status.setControl("monitor", initialControlState);
  status.setControl("executor", initialControlState);
  const settings = createSettingsController({
    config,
    settingsFile: config.settingsFilePath,
  });
  const prompts = createPromptFileAccess({
    monitor: config.monitor.promptPath,
    executor: config.executor.promptPath,
  });
  const dashboard = mountDashboard({
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
  });

  const monitorLog = new SessionLog(join(config.logsDir, "monitor"));
  const executorLog = new SessionLog(join(config.logsDir, "executor"));
  const summarizerLog = new SessionLog(join(config.logsDir, "summarizer"));

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
    reporter: teeSession(status.executor, summarizerLog.sink),
    limitGate,
  });

  let loopError: unknown;
  try {
    await Promise.all([
      runMonitorLoop(
        config,
        store,
        waker,
        teeSession(status.monitor, monitorLog.sink),
        monitorControl,
        limitGate,
        signal,
      ),
      runExecutorLoop(
        config,
        store,
        waker,
        teeSession(status.executor, executorLog.sink),
        summarizer,
        executorControl,
        limitGate,
        signal,
      ),
    ]);
  } catch (err) {
    loopError = err;
  } finally {
    await Promise.all([monitorLog.close(), executorLog.close(), summarizerLog.close()]);
    dashboard.unmount();
    await dashboard.waitUntilExit();
    memory.close();
    status.dispose();
  }

  if (loopError !== undefined) {
    logger.error(loopError instanceof Error ? loopError.message : loopError);
    process.exitCode = 1;
  }
}
