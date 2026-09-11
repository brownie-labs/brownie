import { execFile } from "node:child_process";
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
const LOGIN_HINT =
  "not logged in — run `claude auth login`, or set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY";
const AUTH_UNVERIFIED_LABEL =
  "Claude Code login (not verified — `claude auth status` unavailable)";
const AUTH_STATUS_TIMEOUT_MS = 10_000;

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod?: string | undefined;
  apiKeySource?: string | undefined;
}

export interface PreflightOptions {
  authStatusTimeoutMs?: number | undefined;
}

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

async function locateClaude(): Promise<{ check: Check; path: string | undefined }> {
  const found = await findOnPath(COMMAND);
  return {
    path: found,
    check: check(
      `Claude Code (${COMMAND})`,
      found !== undefined,
      `command "${COMMAND}" not found in PATH — install Claude Code: ${INSTALL_HINT}`,
    ),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseClaudeAuthStatus(output: string): ClaudeAuthStatus | null {
  const trimmed = output.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.loggedIn !== "boolean") return null;
  return {
    loggedIn: record.loggedIn,
    authMethod: optionalString(record.authMethod),
    apiKeySource: optionalString(record.apiKeySource),
  };
}

function runForStdout(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, encoding: "utf8", windowsHide: true },
      (error, stdout) => {
        if (stdout.trim() !== "") {
          resolve(stdout);
          return;
        }
        reject(error ?? new Error(`${file} produced no output`));
      },
    );
  });
}

async function checkClaudeAuth(claudePath: string, timeoutMs: number): Promise<Check> {
  const status = await runForStdout(claudePath, ["auth", "status", "--json"], timeoutMs)
    .then(parseClaudeAuthStatus)
    .catch(() => null);
  if (status === null) {
    logger.warn(
      "Could not verify the Claude Code login (`claude auth status --json` gave no JSON — older CLI?); continuing",
    );
    return { label: AUTH_UNVERIFIED_LABEL, ok: true };
  }
  const via = status.apiKeySource ?? status.authMethod ?? "unknown";
  return check(`Claude Code login (${via})`, status.loggedIn, LOGIN_HINT);
}

async function checkClaudeAndAuth(timeoutMs: number): Promise<Check[]> {
  const located = await locateClaude();
  if (located.path === undefined) return [located.check];
  return [located.check, await checkClaudeAuth(located.path, timeoutMs)];
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

export async function ensureReady(
  dirs: ConfigDirs = {},
  options: PreflightOptions = {},
): Promise<WorkerPromptPaths> {
  const paths = resolvePromptPaths(dirs);

  const [claudeChecks, ...fileChecks] = await Promise.all([
    checkClaudeAndAuth(options.authStatusTimeoutMs ?? AUTH_STATUS_TIMEOUT_MS),
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
  const checks = [...claudeChecks, ...fileChecks];

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
