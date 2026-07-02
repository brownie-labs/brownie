export interface AgentConfig {
  model: string;
  promptPath: string;
  systemPromptPath: string;
  sessionTimeoutMs?: number | undefined;
}

export interface MonitorSchedule {
  startMinute: number;
  endMinute: number;
  days: readonly number[];
}

export interface MonitorConfig extends AgentConfig {
  intervalMs: number;
  schedule: MonitorSchedule | null;
}

export interface ExecutorConfig extends AgentConfig {
  maxTaskAttempts: number;
  retryDelayMs: number;
}

export interface WorkerConfig {
  command: string;
  monitor: MonitorConfig;
  executor: ExecutorConfig;
  streamPartial: boolean;
  cwd: string;
  tasksFilePath: string;
  childEnv: NodeJS.ProcessEnv;
}

export type SessionFailureReason = "timeout" | "abort" | "isError" | "exit" | "spawn";

export interface SessionResult {
  ok: boolean;
  durationMs: number;
  costUsd?: number | undefined;
  numTurns?: number | undefined;
  sessionId?: string | undefined;
  resultText?: string | undefined;
  error?: string | undefined;
  failureReason?: SessionFailureReason | undefined;
}

export interface SessionSummary {
  costUsd?: number | undefined;
  numTurns?: number | undefined;
  sessionId?: string | undefined;
  isError?: boolean | undefined;
  resultText?: string | undefined;
}

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  error?: string | undefined;
}

export type NewTask = Pick<Task, "id" | "title" | "description">;
