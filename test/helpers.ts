import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { ConsolaInstance } from "consola";
import type { SessionSpec } from "../src/runner.js";
import type { AgentConfig, MonitorConfig, WorkerConfig } from "../src/types.js";

export function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "claude-worker-test-"));
}

export function removeTempDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true });
}

export const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
export const fakeClaudePath = join(fixturesDir, "claude");

export function snapshotEnv(): () => void {
  const saved = { ...process.env };
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  };
}

export interface SeedWorkerFilesOptions {
  env?: string | false;
  monitorPrompt?: string;
  monitorSystem?: string;
  executorPrompt?: string;
  executorSystem?: string;
}

export async function seedWorkerFiles(
  dir: string,
  options: SeedWorkerFilesOptions = {},
): Promise<void> {
  const {
    env = "CLAUDE_WORKER_MONITOR_MODEL=haiku\n",
    monitorPrompt = "obserwuj\n",
    monitorSystem = "system monitora\n",
    executorPrompt = "wykonuj\n",
    executorSystem = "system egzekutora\n",
  } = options;
  const promptsDir = join(dir, "prompts");
  await mkdir(promptsDir, { recursive: true });
  await writeFile(join(promptsDir, "monitor.prompt.md"), monitorPrompt, "utf8");
  await writeFile(join(promptsDir, "monitor.system.md"), monitorSystem, "utf8");
  await writeFile(join(promptsDir, "executor.prompt.md"), executorPrompt, "utf8");
  await writeFile(join(promptsDir, "executor.system.md"), executorSystem, "utf8");
  if (env !== false) await writeFile(join(dir, ".env"), env, "utf8");
}

export function fakeClaudeEnv(
  mode: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return { ...process.env, FAKE_CLAUDE_MODE: mode, ...extra };
}

export function fakeClaudeCliEnv(
  mode: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${fixturesDir}${delimiter}${process.env.PATH ?? ""}`,
    FAKE_CLAUDE_MODE: mode,
    ...extra,
  };
}

export function loggerModuleMock(): Record<string, unknown> {
  const shared = {
    info: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    start: vi.fn(),
  };
  return { logger: shared, monitorLogger: shared, executorLogger: shared };
}

export interface FakeLogger {
  instance: ConsolaInstance;
  info: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
}

export function createFakeLogger(): FakeLogger {
  const spies = {
    info: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    start: vi.fn(),
  };
  return {
    ...spies,
    instance: spies as unknown as ConsolaInstance,
  };
}

export function buildAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    model: "haiku",
    promptPath: "/dev/null",
    systemPromptPath: "/dev/null",
    sessionTimeoutMs: undefined,
    ...overrides,
  };
}

export function buildMonitorConfig(
  overrides: Partial<MonitorConfig> = {},
): MonitorConfig {
  return {
    ...buildAgentConfig(),
    intervalMs: 300_000,
    schedule: null,
    ...overrides,
  };
}

export function buildConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    command: fakeClaudePath,
    monitor: buildMonitorConfig(),
    executor: buildAgentConfig({ model: "opus" }),
    streamPartial: false,
    cwd: process.cwd(),
    tasksFilePath: join(process.cwd(), "data", "tasks.json"),
    childEnv: { ...process.env },
    ...overrides,
  };
}

export function buildSessionSpec(
  log: ConsolaInstance,
  overrides: Partial<SessionSpec> = {},
): SessionSpec {
  return {
    command: fakeClaudePath,
    model: "haiku",
    systemPrompt: "system\n",
    prompt: "zadanie\n",
    sessionTimeoutMs: undefined,
    streamPartial: false,
    cwd: process.cwd(),
    childEnv: { ...process.env },
    log,
    ...overrides,
  };
}
