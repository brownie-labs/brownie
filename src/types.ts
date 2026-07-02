import type { PermissionMode } from "./config.js";

export interface AgentConfig {
  model: string;
  promptPath: string;
  systemPromptPath: string;
  permissionMode?: PermissionMode | undefined;
  sessionTimeoutMs?: number | undefined;
}

export interface MonitorConfig extends AgentConfig {
  intervalMs: number;
}

export interface WorkerConfig {
  command: string;
  monitor: MonitorConfig;
  executor: AgentConfig;
  streamPartial: boolean;
  cwd: string;
  tasksFilePath: string;
  childEnv: NodeJS.ProcessEnv;
}

export interface SessionResult {
  ok: boolean;
  durationMs: number;
  costUsd?: number | undefined;
  numTurns?: number | undefined;
  sessionId?: string | undefined;
  resultText?: string | undefined;
  error?: string | undefined;
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
  createdAt: string;
  updatedAt: string;
  error?: string | undefined;
}

export type NewTask = Pick<Task, "id" | "title" | "description">;
