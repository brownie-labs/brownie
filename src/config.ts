import { existsSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { WorkerConfig } from "./types.js";

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return value;
}

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => /^(1|true|yes|on)$/i.test((v ?? "").trim()));

const COMMAND = "claude";

const envSchema = z.object({
  CLAUDE_WORKER_MODEL: z.string().trim().min(1).default("haiku"),
  CLAUDE_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  CLAUDE_WORKER_PROMPT_FILE: z.string().trim().min(1).default("./prompts/prompt.md"),
  CLAUDE_WORKER_SYSTEM_PROMPT_FILE: z
    .string()
    .trim()
    .min(1)
    .default("./prompts/system.md"),
  CLAUDE_WORKER_PERMISSION_MODE: z
    .enum(["default", "acceptEdits", "bypassPermissions", "plan"])
    .optional(),
  CLAUDE_WORKER_SESSION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CLAUDE_WORKER_STREAM_PARTIAL: boolFromEnv,
  CLAUDE_WORKER_CWD: z.string().trim().min(1).optional(),
});

export function loadEnvFile(envFile?: string): void {
  const path = envFile ? resolve(envFile) : resolve(process.cwd(), ".env");
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

async function assertReadable(path: string, label: string): Promise<void> {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`Nie można odczytać ${label}: ${path}`);
  }
}

export async function loadWorkerConfig(envFile?: string): Promise<WorkerConfig> {
  loadEnvFile(envFile);

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Nieprawidłowa konfiguracja (.env):\n${issues}`);
  }
  const env = parsed.data;

  const cwd = env.CLAUDE_WORKER_CWD ? expandHome(env.CLAUDE_WORKER_CWD) : process.cwd();
  const resolvePath = (p: string) =>
    isAbsolute(p) ? p : resolve(process.cwd(), expandHome(p));
  const promptPath = resolvePath(env.CLAUDE_WORKER_PROMPT_FILE);
  const systemPromptPath = resolvePath(env.CLAUDE_WORKER_SYSTEM_PROMPT_FILE);

  await assertReadable(promptPath, "plik promptu (CLAUDE_WORKER_PROMPT_FILE)");
  await assertReadable(
    systemPromptPath,
    "plik system promptu (CLAUDE_WORKER_SYSTEM_PROMPT_FILE)",
  );

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (childEnv.CLAUDE_CONFIG_DIR) {
    childEnv.CLAUDE_CONFIG_DIR = expandHome(childEnv.CLAUDE_CONFIG_DIR);
  }

  return {
    command: COMMAND,
    model: env.CLAUDE_WORKER_MODEL,
    intervalMs: env.CLAUDE_WORKER_INTERVAL_MS,
    promptPath,
    systemPromptPath,
    permissionMode: env.CLAUDE_WORKER_PERMISSION_MODE,
    sessionTimeoutMs: env.CLAUDE_WORKER_SESSION_TIMEOUT_MS,
    streamPartial: env.CLAUDE_WORKER_STREAM_PARTIAL,
    cwd,
    childEnv,
  };
}
