export interface WorkerConfig {
  command: string;
  model: string;
  intervalMs: number;
  promptPath: string;
  systemPromptPath: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
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
