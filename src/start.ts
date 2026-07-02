import { defineCommand, type ArgsDef } from "citty";
import { loadWorkerConfig } from "./config.js";
import { ensureReady } from "./preflight.js";
import { runScheduler } from "./scheduler.js";
import { abortOnSignals } from "./shutdown.js";
import { logger } from "./logger.js";

const envFileArg = {
  "env-file": {
    type: "string",
    description: "Ścieżka do pliku .env (domyślnie ./.env)",
  },
} satisfies ArgsDef;

async function startWorker(envFile?: string): Promise<void> {
  let config;
  try {
    await ensureReady(envFile);
    config = await loadWorkerConfig(envFile);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  await runScheduler(config, abortOnSignals());
}

export const startCommand = defineCommand({
  meta: {
    name: "start",
    description: "Uruchamia workera w stałym rytmie",
  },
  args: envFileArg,
  run: ({ args }) => startWorker(args["env-file"]),
});
