import { defineCommand, runMain } from "citty";
import { loadWorkerConfig } from "./config.js";
import { runScheduler } from "./scheduler.js";
import { initCommand } from "./init.js";
import { logger } from "./logger.js";

const main = defineCommand({
  meta: {
    name: "claude-worker",
    description: "Cyklicznie uruchamia sesje Claude Code (claude -p) w stałym rytmie",
  },
  subCommands: {
    init: initCommand,
  },
  args: {
    "env-file": {
      type: "string",
      description: "Ścieżka do pliku .env (domyślnie ./.env)",
    },
  },
  async run({ args }) {
    let config;
    try {
      config = await loadWorkerConfig(args["env-file"]);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
      return;
    }

    const controller = new AbortController();
    let shuttingDown = false;
    const shutdown = (sig: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.warn(`Otrzymano ${sig} — zamykanie…`);
      controller.abort();
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));

    await runScheduler(config, controller.signal);
  },
});

runMain(main);
