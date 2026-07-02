import type { PermissionMode } from "./config.js";

export interface WorkerConfig {
  command: string;
  model: string;
  intervalMs: number;
  promptPath: string;
  systemPromptPath: string;
  permissionMode?: PermissionMode | undefined;
  sessionTimeoutMs?: number | undefined;
  streamPartial: boolean;
  cwd: string;
  childEnv: NodeJS.ProcessEnv;
}

export interface SessionResult {
  ok: boolean;
  durationMs: number;
  costUsd?: number | undefined;
  numTurns?: number | undefined;
  sessionId?: string | undefined;
  error?: string | undefined;
}

export interface SessionSummary {
  costUsd?: number | undefined;
  numTurns?: number | undefined;
  sessionId?: string | undefined;
  isError?: boolean | undefined;
}
