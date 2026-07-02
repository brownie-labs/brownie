import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { consola, type PromptOptions } from "consola";
import { resolveEnvPath } from "./config.js";
import { logger } from "./logger.js";

const CANCELLED_ERROR = "ConsolaPromptCancelledError";
const CANCEL_MESSAGE = "Przerwano — nic nie zmieniono.";
const MODELS = ["haiku", "sonnet", "opus"];

function ask<T extends PromptOptions>(message: string, options: T) {
  return consola.prompt(message, { ...options, cancel: "reject" as const });
}

function isCancellation(err: unknown): boolean {
  return err instanceof Error && err.name === CANCELLED_ERROR;
}

async function confirmOverwrite(paths: string[]): Promise<boolean> {
  const existing = paths.filter((p) => existsSync(p));
  if (existing.length === 0) return true;
  logger.warn(`Istnieją już pliki:\n${existing.map((p) => `  - ${p}`).join("\n")}`);
  return ask("Nadpisać?", { type: "confirm", initial: false });
}

async function askIntervalMinutes(): Promise<number> {
  let minutes = NaN;
  while (!(minutes > 0)) {
    const raw = await ask("Interwał monitora w minutach", {
      type: "text",
      initial: "15",
    });
    minutes = Number(raw.replace(",", "."));
    if (!(minutes > 0)) logger.warn("Podaj dodatnią liczbę minut.");
  }
  return minutes;
}

function buildEnv(
  monitorModel: string,
  executorModel: string,
  intervalMs: number,
  configDir?: string,
): string {
  const lines = [
    `CLAUDE_WORKER_MONITOR_MODEL=${monitorModel}`,
    `CLAUDE_WORKER_MONITOR_INTERVAL_MS=${intervalMs}`,
    `CLAUDE_WORKER_EXECUTOR_MODEL=${executorModel}`,
  ];
  if (configDir) lines.push("", `CLAUDE_CONFIG_DIR=${configDir}`);
  return `${lines.join("\n")}\n`;
}

export const configureCommand = defineCommand({
  meta: {
    name: "configure",
    description:
      "Interaktywnie tworzy .env oraz prompty obu agentów (monitora i egzekutora)",
  },
  async run() {
    const envPath = resolveEnvPath();
    const promptsDir = resolve(process.cwd(), "prompts");
    const monitorPromptPath = resolve(promptsDir, "monitor.prompt.md");
    const executorPromptPath = resolve(promptsDir, "executor.prompt.md");

    try {
      if (!(await confirmOverwrite([envPath, monitorPromptPath, executorPromptPath]))) {
        logger.info(CANCEL_MESSAGE);
        return;
      }

      logger.info(
        "Worker składa się z dwóch agentów: monitor cyklicznie wykrywa pracę do zrobienia " +
          "i dodaje zadania na listę, a egzekutor wykonuje zadania z listy — każde w osobnej sesji.",
      );

      const monitorModel = await ask("Model monitora (tani — tylko wykrywa zadania)", {
        type: "select",
        options: MODELS,
        initial: "haiku",
      });

      const intervalMinutes = await askIntervalMinutes();
      const intervalMs = Math.round(intervalMinutes * 60_000);

      const monitorPrompt = (
        await ask(
          "Co monitor ma obserwować? (np. „zadania w Redmine przypisane do mnie ze statusem Open”)",
          { type: "text" },
        )
      ).trim();

      const executorModel = await ask("Model egzekutora (mocny — wykonuje zadania)", {
        type: "select",
        options: MODELS,
        initial: "opus",
      });

      const executorPrompt = (
        await ask(
          "Kim jest egzekutor i jak ma wykonywać zadania? (tożsamość, zasady pracy, dostępne narzędzia)",
          { type: "text" },
        )
      ).trim();

      const useConfigDir = await ask(
        "Użyć osobnego katalogu konfiguracji Claude (CLAUDE_CONFIG_DIR)?",
        { type: "confirm", initial: false },
      );
      let configDir: string | undefined;
      if (useConfigDir) {
        configDir = (
          await ask("Ścieżka CLAUDE_CONFIG_DIR", {
            type: "text",
            placeholder: "np. ~/.claude-inny-profil",
          })
        ).trim();
      }

      await mkdir(dirname(monitorPromptPath), { recursive: true });
      await writeFile(
        envPath,
        buildEnv(monitorModel, executorModel, intervalMs, configDir),
        "utf8",
      );
      await writeFile(monitorPromptPath, `${monitorPrompt}\n`, "utf8");
      await writeFile(executorPromptPath, `${executorPrompt}\n`, "utf8");

      logger.success(`Zapisano ${envPath}`);
      logger.success(`Zapisano ${monitorPromptPath}`);
      logger.success(`Zapisano ${executorPromptPath}`);
      logger.info(
        "Definicje ról agentów są w prompts/monitor.system.md i prompts/executor.system.md " +
          "(wersjonowane w repo) — możesz je edytować ręcznie.",
      );
      logger.info("Uruchom workera: pnpm start");
    } catch (err) {
      if (isCancellation(err)) {
        logger.info(CANCEL_MESSAGE);
        return;
      }
      throw err;
    }
  },
});
