import { existsSync } from "node:fs";
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
  CLAUDE_WORKER_MONITOR_MODEL: z.string().trim().min(1).default("haiku"),
  CLAUDE_WORKER_MONITOR_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60 * 1000),
  CLAUDE_WORKER_MONITOR_PROMPT_FILE: z
    .string()
    .trim()
    .min(1)
    .default("./prompts/monitor.prompt.md"),
  CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE: z
    .string()
    .trim()
    .min(1)
    .default("./prompts/monitor.system.md"),
  CLAUDE_WORKER_MONITOR_PERMISSION_MODE: z.enum(PERMISSION_MODES).optional(),
  CLAUDE_WORKER_MONITOR_SESSION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CLAUDE_WORKER_EXECUTOR_MODEL: z.string().trim().min(1).default("opus"),
  CLAUDE_WORKER_EXECUTOR_PROMPT_FILE: z
    .string()
    .trim()
    .min(1)
    .default("./prompts/executor.prompt.md"),
  CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE: z
    .string()
    .trim()
    .min(1)
    .default("./prompts/executor.system.md"),
  CLAUDE_WORKER_EXECUTOR_PERMISSION_MODE: z.enum(PERMISSION_MODES).optional(),
  CLAUDE_WORKER_EXECUTOR_SESSION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  CLAUDE_WORKER_TASKS_FILE: z.string().trim().min(1).default("./data/tasks.json"),
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

export type Env = z.infer<typeof envSchema>;

export interface PromptPaths {
  promptPath: string;
  systemPromptPath: string;
}

export interface WorkerPromptPaths {
  monitor: PromptPaths;
  executor: PromptPaths;
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Nieprawidłowa konfiguracja (.env):\n${issues}`);
  }
  return parsed.data;
}

export function resolvePromptPaths(
  env: Pick<
    Env,
    | "CLAUDE_WORKER_MONITOR_PROMPT_FILE"
    | "CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE"
    | "CLAUDE_WORKER_EXECUTOR_PROMPT_FILE"
    | "CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE"
  >,
): WorkerPromptPaths {
  return {
    monitor: {
      promptPath: resolveFromCwd(env.CLAUDE_WORKER_MONITOR_PROMPT_FILE),
      systemPromptPath: resolveFromCwd(env.CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE),
    },
    executor: {
      promptPath: resolveFromCwd(env.CLAUDE_WORKER_EXECUTOR_PROMPT_FILE),
      systemPromptPath: resolveFromCwd(env.CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE),
    },
  };
}

export const PROMPT_FILE_LABELS = {
  monitor: {
    promptPath: "plik promptu monitora (CLAUDE_WORKER_MONITOR_PROMPT_FILE)",
    systemPromptPath:
      "plik system promptu monitora (CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE)",
  },
  executor: {
    promptPath: "plik promptu egzekutora (CLAUDE_WORKER_EXECUTOR_PROMPT_FILE)",
    systemPromptPath:
      "plik system promptu egzekutora (CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE)",
  },
} as const;

async function assertPromptPathsReadable(paths: WorkerPromptPaths): Promise<void> {
  for (const agent of ["monitor", "executor"] as const) {
    for (const key of ["promptPath", "systemPromptPath"] as const) {
      await assertReadable(paths[agent][key], PROMPT_FILE_LABELS[agent][key]);
    }
  }
}

export async function loadWorkerConfig(
  envFile?: string,
  verified?: WorkerPromptPaths,
): Promise<WorkerConfig> {
  if (!verified) loadEnvFile(envFile);
  const env = parseEnv(process.env);

  const paths = verified ?? resolvePromptPaths(env);
  if (!verified) {
    await assertPromptPathsReadable(paths);
  }

  const cwd = resolveFromCwd(env.CLAUDE_WORKER_CWD);
  const tasksFilePath = resolveFromCwd(env.CLAUDE_WORKER_TASKS_FILE);

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (childEnv.CLAUDE_CONFIG_DIR) {
    childEnv.CLAUDE_CONFIG_DIR = expandHome(childEnv.CLAUDE_CONFIG_DIR);
  }

  return {
    command: COMMAND,
    monitor: {
      model: env.CLAUDE_WORKER_MONITOR_MODEL,
      intervalMs: env.CLAUDE_WORKER_MONITOR_INTERVAL_MS,
      promptPath: paths.monitor.promptPath,
      systemPromptPath: paths.monitor.systemPromptPath,
      permissionMode: env.CLAUDE_WORKER_MONITOR_PERMISSION_MODE,
      sessionTimeoutMs: env.CLAUDE_WORKER_MONITOR_SESSION_TIMEOUT_MS,
    },
    executor: {
      model: env.CLAUDE_WORKER_EXECUTOR_MODEL,
      promptPath: paths.executor.promptPath,
      systemPromptPath: paths.executor.systemPromptPath,
      permissionMode: env.CLAUDE_WORKER_EXECUTOR_PERMISSION_MODE,
      sessionTimeoutMs: env.CLAUDE_WORKER_EXECUTOR_SESSION_TIMEOUT_MS,
    },
    streamPartial: env.CLAUDE_WORKER_STREAM_PARTIAL,
    cwd,
    tasksFilePath,
    childEnv,
  };
}
