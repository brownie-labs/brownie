import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { SessionSpec } from "../src/runner.js";
import type { SessionEvent, SessionEventSink } from "../src/session-events.js";
import type { ExecutorReporter, MonitorReporter } from "../src/status.js";
import type {
  AgentConfig,
  ExecutorConfig,
  MonitorConfig,
  WorkerConfig,
} from "../src/types.js";

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
  return { logger: shared };
}

export interface SessionEventCollector {
  events: SessionEvent[];
  sink: SessionEventSink;
}

export function createSessionEventCollector(): SessionEventCollector {
  const events: SessionEvent[] = [];
  return {
    events,
    sink: (event) => {
      events.push(event);
    },
  };
}

export interface MonitorReporterSpy {
  reporter: MonitorReporter;
  offHours: ReturnType<typeof vi.fn>;
  cycleStarted: ReturnType<typeof vi.fn>;
  cycleFinished: ReturnType<typeof vi.fn>;
  sleepUntil: ReturnType<typeof vi.fn>;
  session: ReturnType<typeof vi.fn>;
}

export function createMonitorReporterSpy(): MonitorReporterSpy {
  const spies = {
    offHours: vi.fn(),
    cycleStarted: vi.fn(),
    cycleFinished: vi.fn(),
    sleepUntil: vi.fn(),
    session: vi.fn(),
  };
  return { ...spies, reporter: spies };
}

export interface ExecutorReporterSpy {
  reporter: ExecutorReporter;
  taskStarted: ReturnType<typeof vi.fn>;
  taskFinished: ReturnType<typeof vi.fn>;
  retryScheduled: ReturnType<typeof vi.fn>;
  waiting: ReturnType<typeof vi.fn>;
  session: ReturnType<typeof vi.fn>;
}

export function createExecutorReporterSpy(): ExecutorReporterSpy {
  const spies = {
    taskStarted: vi.fn(),
    taskFinished: vi.fn(),
    retryScheduled: vi.fn(),
    waiting: vi.fn(),
    session: vi.fn(),
  };
  return { ...spies, reporter: spies };
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

export function buildExecutorConfig(
  overrides: Partial<ExecutorConfig> = {},
): ExecutorConfig {
  return {
    ...buildAgentConfig({ model: "opus" }),
    maxTaskAttempts: 3,
    retryDelayMs: 0,
    ...overrides,
  };
}

export function buildConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    command: fakeClaudePath,
    monitor: buildMonitorConfig(),
    executor: buildExecutorConfig(),
    streamPartial: false,
    cwd: process.cwd(),
    tasksFilePath: join(process.cwd(), "data", "tasks.json"),
    logsDir: join(process.cwd(), "logs"),
    childEnv: { ...process.env },
    ...overrides,
  };
}

export function buildSessionSpec(
  events: SessionEventSink,
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
    events,
    ...overrides,
  };
}
