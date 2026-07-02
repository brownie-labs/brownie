import type { PermissionMode } from "./config.js";

export interface WorkerConfig {
  command: string;
  model: string;
  intervalMs: number;
  promptPath: string;
  systemPromptPath: string;
  permissionMode?: PermissionMode;
  sessionTimeoutMs?: number;
  streamPartial: boolean;
  cwd: string;
  childEnv: NodeJS.ProcessEnv;
}

export interface SessionResult {
  ok: boolean;
  durationMs: number;
  costUsd?: number;
  numTurns?: number;
  sessionId?: string;
  error?: string;
}

export interface SessionSummary {
  costUsd?: number;
  numTurns?: number;
  sessionId?: string;
  is_error?: boolean;
}
