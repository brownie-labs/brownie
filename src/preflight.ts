import { constants } from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  COMMAND,
  PROMPT_FILE_LABELS,
  resolvePromptPaths,
  type ConfigDirs,
  type WorkerPromptPaths,
} from "./config.js";
import { canAccess } from "./fs.js";
import { logger } from "./logger.js";
import { projectPaths } from "./paths.js";

const INSTALL_HINT = "https://docs.claude.com/en/docs/claude-code/setup";
const CONFIGURE_HINT = "run brownie in an interactive terminal to complete setup";
const FTS5_HINT =
  "this Node.js build ships node:sqlite without the FTS5 extension — use Node.js >= 22.16 from nodejs.org (or any build compiled with SQLITE_ENABLE_FTS5)";

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
    `command "${COMMAND}" not found in PATH — install Claude Code: ${INSTALL_HINT}`,
  );
}

function checkSqliteFts5(): Check {
  let ok = true;
  try {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE VIRTUAL TABLE probe USING fts5(content)");
    } finally {
      db.close();
    }
  } catch {
    ok = false;
  }
  return check("SQLite FTS5 (long-term memory)", ok, FTS5_HINT);
}

function checkSettingsFile(path: string): Check {
  return check(
    `settings file (${path})`,
    existsSync(path),
    `file missing: ${path} — ${CONFIGURE_HINT}`,
  );
}

async function checkFile(path: string, label: string): Promise<Check> {
  return check(
    `${label} (${path})`,
    await canAccess(path, constants.R_OK),
    `file missing: ${path} — ${CONFIGURE_HINT}`,
  );
}

export async function ensureReady(dirs: ConfigDirs = {}): Promise<WorkerPromptPaths> {
  const paths = resolvePromptPaths(dirs);

  const checks = await Promise.all([
    checkClaude(),
    Promise.resolve(checkSqliteFts5()),
    Promise.resolve(checkSettingsFile(projectPaths(dirs.projectDir).settingsFile)),
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
    throw new Error(`Preflight failed — required items are missing:\n${details}`);
  }

  return paths;
}
