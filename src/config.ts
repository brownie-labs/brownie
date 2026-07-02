import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { assertReadable } from "./fs.js";
import type { WorkerConfig } from "./types.js";

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return value;
}

const boolFromEnv = (defaultValue = false) =>
  z
    .string()
    .optional()
    .transform((v) => {
      const s = (v ?? "").trim();
      if (s === "") return defaultValue;
      return /^(1|true|yes|on)$/i.test(s);
    });

export const COMMAND = "claude";

export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const envSchema = z.object({
  CLAUDE_WORKER_MODEL: z.string().trim().min(1).default("haiku"),
  CLAUDE_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  CLAUDE_WORKER_PROMPT_FILE: z.string().trim().min(1).default("./prompts/prompt.md"),
  CLAUDE_WORKER_SYSTEM_PROMPT_FILE: z
    .string()
    .trim()
    .min(1)
    .default("./prompts/system.md"),
  CLAUDE_WORKER_PERMISSION_MODE: z.enum(PERMISSION_MODES).optional(),
  CLAUDE_WORKER_SESSION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CLAUDE_WORKER_STREAM_PARTIAL: boolFromEnv(true),
  CLAUDE_WORKER_CWD: z.string().trim().min(1).default("./workspace"),
});

export function resolveEnvPath(envFile?: string): string {
  return envFile ? resolve(envFile) : resolve(process.cwd(), ".env");
}

export function resolveFromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), expandHome(value));
}

export function loadEnvFile(envFile?: string): void {
  const path = resolveEnvPath(envFile);
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

export function resolvePromptPaths(source: NodeJS.ProcessEnv = process.env): {
  promptPath: string;
  systemPromptPath: string;
} {
  const { CLAUDE_WORKER_PROMPT_FILE, CLAUDE_WORKER_SYSTEM_PROMPT_FILE } = envSchema
    .pick({ CLAUDE_WORKER_PROMPT_FILE: true, CLAUDE_WORKER_SYSTEM_PROMPT_FILE: true })
    .parse(source);
  return {
    promptPath: resolveFromCwd(CLAUDE_WORKER_PROMPT_FILE),
    systemPromptPath: resolveFromCwd(CLAUDE_WORKER_SYSTEM_PROMPT_FILE),
  };
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

  const { promptPath, systemPromptPath } = resolvePromptPaths(process.env);

  await assertReadable(promptPath, "plik promptu (CLAUDE_WORKER_PROMPT_FILE)");
  await assertReadable(
    systemPromptPath,
    "plik system promptu (CLAUDE_WORKER_SYSTEM_PROMPT_FILE)",
  );

  const cwd = resolveFromCwd(env.CLAUDE_WORKER_CWD);
  await mkdir(cwd, { recursive: true });

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
