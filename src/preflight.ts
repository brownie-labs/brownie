import { constants } from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  COMMAND,
  loadEnvFile,
  parseEnv,
  PROMPT_FILE_LABELS,
  resolveEnvPath,
  resolvePromptPaths,
  type WorkerPromptPaths,
} from "./config.js";
import { canAccess } from "./fs.js";
import { logger } from "./logger.js";

const INSTALL_HINT = "https://docs.claude.com/en/docs/claude-code/setup";
const CONFIGURE_HINT = "utwórz konfigurację: pnpm configure";

interface Check {
  label: string;
  ok: boolean;
  problem?: string;
}

function check(label: string, ok: boolean, problem: string): Check {
  return ok ? { label, ok } : { label, ok, problem };
}

const WINDOWS_EXTENSIONS = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
  .split(";")
  .filter(Boolean);

async function findOnPath(command: string): Promise<string | undefined> {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const names =
    process.platform === "win32"
      ? WINDOWS_EXTENSIONS.map((ext) => command + ext.toLowerCase())
      : [command];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (await canAccess(candidate, constants.X_OK)) return candidate;
    }
  }
  return undefined;
}

async function checkClaude(): Promise<Check> {
  const found = await findOnPath(COMMAND);
  return check(
    `Claude Code (${COMMAND})`,
    found !== undefined,
    `nie znaleziono polecenia "${COMMAND}" w PATH — zainstaluj Claude Code: ${INSTALL_HINT}`,
  );
}

function checkEnvFile(envFile?: string): Check {
  const path = resolveEnvPath(envFile);
  return check(
    `plik .env (${path})`,
    existsSync(path),
    `brak pliku: ${path} — ${CONFIGURE_HINT}`,
  );
}

async function checkFile(path: string, label: string): Promise<Check> {
  return check(
    `${label} (${path})`,
    await canAccess(path, constants.R_OK),
    `brak pliku: ${path} — ${CONFIGURE_HINT}`,
  );
}

export async function ensureReady(envFile?: string): Promise<WorkerPromptPaths> {
  loadEnvFile(envFile);
  const env = parseEnv(process.env);
  const paths = resolvePromptPaths(env);

  const checks = await Promise.all([
    checkClaude(),
    Promise.resolve(checkEnvFile(envFile)),
    checkFile(paths.monitor.promptPath, PROMPT_FILE_LABELS.monitor.promptPath),
    checkFile(
      paths.monitor.systemPromptPath,
      PROMPT_FILE_LABELS.monitor.systemPromptPath,
    ),
    checkFile(paths.executor.promptPath, PROMPT_FILE_LABELS.executor.promptPath),
    checkFile(
      paths.executor.systemPromptPath,
      PROMPT_FILE_LABELS.executor.systemPromptPath,
    ),
    checkFile(
      paths.summarizer.systemPromptPath,
      PROMPT_FILE_LABELS.summarizer.systemPromptPath,
    ),
  ]);

  for (const result of checks) {
    if (result.ok) logger.success(result.label);
    else logger.error(result.label);
  }

  const problems = checks.filter((c) => !c.ok);
  if (problems.length > 0) {
    const details = problems.map((c) => `  - ${c.problem ?? c.label}`).join("\n");
    throw new Error(`Preflight nieudany — brakuje wymaganych elementów:\n${details}`);
  }

  return paths;
}
