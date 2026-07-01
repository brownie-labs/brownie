import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { consola } from "consola";
import { logger } from "./logger.js";

const CANCELLED = Symbol("cancelled");

function ensureText<T>(value: T): T {
  if (typeof value === "symbol") throw CANCELLED;
  return value;
}

async function confirmOverwrite(paths: string[]): Promise<boolean> {
  const existing = paths.filter((p) => existsSync(p));
  if (existing.length === 0) return true;
  logger.warn(`Istnieją już pliki:\n${existing.map((p) => `  - ${p}`).join("\n")}`);
  return ensureText(
    await consola.prompt("Nadpisać?", { type: "confirm", initial: false }),
  );
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
    const envPath = resolve(process.cwd(), ".env");
    const promptPath = resolve(process.cwd(), "prompts", "prompt.md");

    try {
      if (!(await confirmOverwrite([envPath, promptPath]))) {
        logger.info("Przerwano — nic nie zmieniono.");
        return;
      }

      const model = ensureText(
        await consola.prompt("Model sesji", {
          type: "select",
          options: ["haiku", "sonnet", "opus"],
          initial: "haiku",
        }),
      );

      let intervalMinutes = NaN;
      while (!(intervalMinutes > 0)) {
        const raw = ensureText(
          await consola.prompt("Interwał w minutach", {
            type: "text",
            initial: "5",
          }),
        );
        intervalMinutes = Number(String(raw).replace(",", "."));
        if (!(intervalMinutes > 0)) logger.warn("Podaj dodatnią liczbę minut.");
      }
      const intervalMs = Math.round(intervalMinutes * 60_000);

      const prompt = ensureText(
        await consola.prompt("Zadanie workera (prompt)", { type: "text" }),
      ).trim();

      const useConfigDir = ensureText(
        await consola.prompt("Użyć osobnego katalogu konfiguracji Claude (CLAUDE_CONFIG_DIR)?", {
          type: "confirm",
          initial: false,
        }),
      );
      let configDir: string | undefined;
      if (useConfigDir) {
        configDir = ensureText(
          await consola.prompt("Ścieżka CLAUDE_CONFIG_DIR", {
            type: "text",
            placeholder: "np. ~/.claude-inny-profil",
          }),
        ).trim();
      }

      await mkdir(dirname(promptPath), { recursive: true });
      await writeFile(envPath, buildEnv(String(model), intervalMs, configDir), "utf8");
      await writeFile(promptPath, `${prompt}\n`, "utf8");

      logger.success(`Zapisano ${envPath}`);
      logger.success(`Zapisano ${promptPath}`);
      logger.info("Uruchom workera: pnpm start");
    } catch (err) {
      if (err === CANCELLED) {
        logger.info("Przerwano — nic nie zmieniono.");
        return;
      }
      throw err;
    }
  },
});
