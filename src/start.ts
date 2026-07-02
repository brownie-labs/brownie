import { mkdir } from "node:fs/promises";
import { defineCommand, type ArgsDef } from "citty";
import { loadWorkerConfig } from "./config.js";
import { runExecutorLoop } from "./executor.js";
import { logger } from "./logger.js";
import { runMonitorLoop } from "./monitor.js";
import { ensureReady } from "./preflight.js";
import { abortOnSignals } from "./shutdown.js";
import { TaskStore } from "./tasks.js";
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

  const signal = abortOnSignals();
  const waker = new Waker();

  await Promise.all([
    runMonitorLoop(config, store, waker, signal),
    runExecutorLoop(config, store, waker, signal),
  ]);
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
