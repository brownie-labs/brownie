import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { buildSchedule, parseActiveDays, parseTimeWindow } from "./active-hours.js";
import { assertReadable } from "./fs.js";
import { buildMcpConfig } from "./memory/mcp.js";
import { EFFORT_LEVELS, type WorkerConfig } from "./types.js";

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return value;
}

const optionalRawEnv = (validate: (value: string) => unknown) =>
  z
    .string()
    .trim()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === "") return;
      try {
        validate(value);
      } catch (err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: (err as Error).message });
      }
    });

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

export const envSchema = z.object({
  CLAUDE_WORKER_MONITOR_MODEL: z.string().trim().min(1).default("sonnet"),
  CLAUDE_WORKER_MONITOR_EFFORT: z.enum(EFFORT_LEVELS).default("medium"),
  CLAUDE_WORKER_MONITOR_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  CLAUDE_WORKER_MONITOR_ACTIVE_HOURS: optionalRawEnv(parseTimeWindow),
  CLAUDE_WORKER_MONITOR_ACTIVE_DAYS: optionalRawEnv(parseActiveDays),
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
  CLAUDE_WORKER_MONITOR_SESSION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CLAUDE_WORKER_EXECUTOR_MODEL: z.string().trim().min(1).default("opus"),
  CLAUDE_WORKER_EXECUTOR_EFFORT: z.enum(EFFORT_LEVELS).default("high"),
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
  CLAUDE_WORKER_EXECUTOR_SESSION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  CLAUDE_WORKER_EXECUTOR_TASK_ATTEMPTS: z.coerce.number().int().positive().default(3),
  CLAUDE_WORKER_SUMMARIZER_MODEL: z.string().trim().min(1).default("sonnet"),
  CLAUDE_WORKER_SUMMARIZER_EFFORT: z.enum(EFFORT_LEVELS).default("medium"),
  CLAUDE_WORKER_SUMMARIZER_SYSTEM_PROMPT_FILE: z
    .string()
    .trim()
    .min(1)
    .default("./prompts/summarizer.system.md"),
  CLAUDE_WORKER_SUMMARIZER_SESSION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(300_000),
  CLAUDE_WORKER_MEMORY_DB: z.string().trim().min(1).default("./data/memory.db"),
  CLAUDE_WORKER_EXECUTOR_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(30_000),
  CLAUDE_WORKER_TASKS_FILE: z.string().trim().min(1).default("./data/tasks.json"),
  CLAUDE_WORKER_LOGS_DIR: z.string().trim().min(1).default("./logs"),
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
  summarizer: Pick<PromptPaths, "systemPromptPath">;
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration (.env):\n${issues}`);
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
    | "CLAUDE_WORKER_SUMMARIZER_SYSTEM_PROMPT_FILE"
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
    summarizer: {
      systemPromptPath: resolveFromCwd(env.CLAUDE_WORKER_SUMMARIZER_SYSTEM_PROMPT_FILE),
    },
  };
}

export const PROMPT_FILE_LABELS = {
  monitor: {
    promptPath: "monitor prompt file (CLAUDE_WORKER_MONITOR_PROMPT_FILE)",
    systemPromptPath:
      "monitor system prompt file (CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE)",
  },
  executor: {
    promptPath: "executor prompt file (CLAUDE_WORKER_EXECUTOR_PROMPT_FILE)",
    systemPromptPath:
      "executor system prompt file (CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE)",
  },
  summarizer: {
    systemPromptPath:
      "summarizer system prompt file (CLAUDE_WORKER_SUMMARIZER_SYSTEM_PROMPT_FILE)",
  },
} as const;

async function assertPromptPathsReadable(paths: WorkerPromptPaths): Promise<void> {
  for (const agent of ["monitor", "executor"] as const) {
    for (const key of ["promptPath", "systemPromptPath"] as const) {
      await assertReadable(paths[agent][key], PROMPT_FILE_LABELS[agent][key]);
    }
  }
  await assertReadable(
    paths.summarizer.systemPromptPath,
    PROMPT_FILE_LABELS.summarizer.systemPromptPath,
  );
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
  const memoryDbPath = resolveFromCwd(env.CLAUDE_WORKER_MEMORY_DB);
  const logsDir = resolveFromCwd(env.CLAUDE_WORKER_LOGS_DIR);

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (childEnv.CLAUDE_CONFIG_DIR) {
    childEnv.CLAUDE_CONFIG_DIR = expandHome(childEnv.CLAUDE_CONFIG_DIR);
  }

  return {
    command: COMMAND,
    monitor: {
      model: env.CLAUDE_WORKER_MONITOR_MODEL,
      effort: env.CLAUDE_WORKER_MONITOR_EFFORT,
      intervalMs: env.CLAUDE_WORKER_MONITOR_INTERVAL_MS,
      schedule: buildSchedule(
        env.CLAUDE_WORKER_MONITOR_ACTIVE_HOURS,
        env.CLAUDE_WORKER_MONITOR_ACTIVE_DAYS,
      ),
      promptPath: paths.monitor.promptPath,
      systemPromptPath: paths.monitor.systemPromptPath,
      sessionTimeoutMs: env.CLAUDE_WORKER_MONITOR_SESSION_TIMEOUT_MS,
    },
    executor: {
      model: env.CLAUDE_WORKER_EXECUTOR_MODEL,
      effort: env.CLAUDE_WORKER_EXECUTOR_EFFORT,
      promptPath: paths.executor.promptPath,
      systemPromptPath: paths.executor.systemPromptPath,
      sessionTimeoutMs: env.CLAUDE_WORKER_EXECUTOR_SESSION_TIMEOUT_MS,
      maxTaskAttempts: env.CLAUDE_WORKER_EXECUTOR_TASK_ATTEMPTS,
      retryDelayMs: env.CLAUDE_WORKER_EXECUTOR_RETRY_DELAY_MS,
      mcpConfig: buildMcpConfig(memoryDbPath),
    },
    summarizer: {
      model: env.CLAUDE_WORKER_SUMMARIZER_MODEL,
      effort: env.CLAUDE_WORKER_SUMMARIZER_EFFORT,
      systemPromptPath: paths.summarizer.systemPromptPath,
      sessionTimeoutMs: env.CLAUDE_WORKER_SUMMARIZER_SESSION_TIMEOUT_MS,
    },
    streamPartial: env.CLAUDE_WORKER_STREAM_PARTIAL,
    cwd,
    tasksFilePath,
    memoryDbPath,
    logsDir,
    childEnv,
  };
}
