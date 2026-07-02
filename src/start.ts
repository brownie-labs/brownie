import { mkdir } from "node:fs/promises";
import { defineCommand, type ArgsDef } from "citty";
import { loadWorkerConfig } from "./config.js";
import { runExecutorLoop } from "./executor.js";
import { logger } from "./logger.js";
import { runMonitorLoop } from "./monitor.js";
import { ensureReady } from "./preflight.js";
import { abortOnSignals } from "./shutdown.js";
import { WorkerStatusStore } from "./status.js";
import { TaskStore } from "./tasks.js";
import { mountDashboard } from "./ui/mount.js";
import { Waker } from "./waker.js";

const envFileArg = {
  "env-file": {
    type: "string",
    description: "Ścieżka do pliku .env (domyślnie ./.env)",
  },
} satisfies ArgsDef;

async function startWorker(envFile?: string): Promise<void> {
  let config;
  let store;
  try {
    const paths = await ensureReady(envFile);
    config = await loadWorkerConfig(envFile, paths);
    await mkdir(config.cwd, { recursive: true });
    store = await TaskStore.open(config.tasksFilePath);
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
  const dashboard = mountDashboard(status, config);

  let loopError: unknown;
  try {
    await Promise.all([
      runMonitorLoop(config, store, waker, status.monitor, signal),
      runExecutorLoop(config, store, waker, status.executor, signal),
    ]);
  } catch (err) {
    loopError = err;
  } finally {
    dashboard.unmount();
    await dashboard.waitUntilExit();
    status.dispose();
  }

  if (loopError !== undefined) {
    logger.error(loopError instanceof Error ? loopError.message : loopError);
    process.exitCode = 1;
  }
}

export const startCommand = defineCommand({
  meta: {
    name: "start",
    description:
      "Uruchamia workera: monitor cyklicznie zgłasza zadania, egzekutor je wykonuje",
  },
  args: envFileArg,
  run: ({ args }) => startWorker(args["env-file"]),
});
