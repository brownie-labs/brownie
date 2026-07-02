import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { ConsolaInstance } from "consola";
import type { WorkerConfig } from "../src/types.js";

export function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "claude-worker-test-"));
}

export function removeTempDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true });
}

export const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
export const fakeClaudePath = join(fixturesDir, "claude");

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

export function buildConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    command: fakeClaudePath,
    model: "haiku",
    intervalMs: 300_000,
    promptPath: "/dev/null",
    systemPromptPath: "/dev/null",
    permissionMode: undefined,
    sessionTimeoutMs: undefined,
    streamPartial: false,
    cwd: process.cwd(),
    childEnv: { ...process.env },
    ...overrides,
  };
}
