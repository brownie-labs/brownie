import { constants } from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { COMMAND, loadEnvFile, resolveEnvPath, resolvePromptPaths } from "./config.js";
import { canAccess } from "./fs.js";
import { logger } from "./logger.js";

const INSTALL_HINT = "https://docs.claude.com/en/docs/claude-code/setup";
const CONFIGURE_HINT = "utwórz konfigurację: pnpm configure";

interface Check {
  label: string;
  ok: boolean;
  problem?: string;
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
  return found
    ? { label: `Claude Code (${COMMAND})`, ok: true }
    : {
        label: `Claude Code (${COMMAND})`,
        ok: false,
        problem: `nie znaleziono polecenia "${COMMAND}" w PATH — zainstaluj Claude Code: ${INSTALL_HINT}`,
      };
}

function checkEnvFile(envFile?: string): Check {
  const path = resolveEnvPath(envFile);
  const ok = existsSync(path);
  return {
    label: `plik .env (${path})`,
    ok,
    problem: ok ? undefined : `brak pliku: ${path} — ${CONFIGURE_HINT}`,
  };
}

async function checkFile(path: string, label: string): Promise<Check> {
  const ok = await canAccess(path, constants.R_OK);
  return {
    label: `${label} (${path})`,
    ok,
    problem: ok ? undefined : `brak pliku: ${path} — ${CONFIGURE_HINT}`,
  };
}

export async function ensureReady(envFile?: string): Promise<void> {
  loadEnvFile(envFile);
  const { promptPath, systemPromptPath } = resolvePromptPaths(process.env);

  const checks = await Promise.all([
    checkClaude(),
    Promise.resolve(checkEnvFile(envFile)),
    checkFile(promptPath, "plik promptu"),
    checkFile(systemPromptPath, "plik system promptu"),
  ]);

  for (const check of checks) {
    if (check.ok) logger.success(check.label);
    else logger.error(check.label);
  }

  const problems = checks.filter((c) => !c.ok);
  if (problems.length > 0) {
    const details = problems.map((c) => `  - ${c.problem}`).join("\n");
    throw new Error(`Preflight nieudany — brakuje wymaganych elementów:\n${details}`);
  }
}
