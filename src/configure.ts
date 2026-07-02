import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { consola, type PromptOptions } from "consola";
import { resolveEnvPath } from "./config.js";
import { logger } from "./logger.js";

const CANCELLED_ERROR = "ConsolaPromptCancelledError";

function ask<T>(message: string, options: PromptOptions): Promise<T> {
  return consola.prompt(message, { ...options, cancel: "reject" }) as Promise<T>;
}

function isCancellation(err: unknown): boolean {
  return err instanceof Error && err.name === CANCELLED_ERROR;
}

async function confirmOverwrite(paths: string[]): Promise<boolean> {
  const existing = paths.filter((p) => existsSync(p));
  if (existing.length === 0) return true;
  logger.warn(`Istnieją już pliki:\n${existing.map((p) => `  - ${p}`).join("\n")}`);
  return ask<boolean>("Nadpisać?", { type: "confirm", initial: false });
}

function buildEnv(model: string, intervalMs: number, configDir?: string): string {
  const lines = [
    `CLAUDE_WORKER_MODEL=${model}`,
    `CLAUDE_WORKER_INTERVAL_MS=${intervalMs}`,
  ];
  if (configDir) lines.push("", `CLAUDE_CONFIG_DIR=${configDir}`);
  return `${lines.join("\n")}\n`;
}

export const configureCommand = defineCommand({
  meta: {
    name: "configure",
    description: "Interaktywnie tworzy pliki .env oraz prompts/prompt.md",
  },
  async run() {
    const envPath = resolveEnvPath();
    const promptPath = resolve(process.cwd(), "prompts", "prompt.md");

    try {
      if (!(await confirmOverwrite([envPath, promptPath]))) {
        logger.info("Przerwano — nic nie zmieniono.");
        return;
      }

      const model = await ask<string>("Model sesji", {
        type: "select",
        options: ["haiku", "sonnet", "opus"],
        initial: "haiku",
      });

      let intervalMinutes = NaN;
      while (!(intervalMinutes > 0)) {
        const raw = await ask<string>("Interwał w minutach", {
          type: "text",
          initial: "5",
        });
        intervalMinutes = Number(raw.replace(",", "."));
        if (!(intervalMinutes > 0)) logger.warn("Podaj dodatnią liczbę minut.");
      }
      const intervalMs = Math.round(intervalMinutes * 60_000);

      const prompt = (
        await ask<string>("Zadanie workera (prompt)", { type: "text" })
      ).trim();

      const useConfigDir = await ask<boolean>(
        "Użyć osobnego katalogu konfiguracji Claude (CLAUDE_CONFIG_DIR)?",
        { type: "confirm", initial: false },
      );
      let configDir: string | undefined;
      if (useConfigDir) {
        configDir = (
          await ask<string>("Ścieżka CLAUDE_CONFIG_DIR", {
            type: "text",
            placeholder: "np. ~/.claude-inny-profil",
          })
        ).trim();
      }

      await mkdir(dirname(promptPath), { recursive: true });
      await writeFile(envPath, buildEnv(model, intervalMs, configDir), "utf8");
      await writeFile(promptPath, `${prompt}\n`, "utf8");

      logger.success(`Zapisano ${envPath}`);
      logger.success(`Zapisano ${promptPath}`);
      logger.info("Uruchom workera: pnpm start");
    } catch (err) {
      if (isCancellation(err)) {
        logger.info("Przerwano — nic nie zmieniono.");
        return;
      }
      throw err;
    }
  },
});
