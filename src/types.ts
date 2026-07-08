export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const MODELS = ["haiku", "sonnet", "opus"] as const;

export const MODELS_WITHOUT_EFFORT: ReadonlySet<string> = new Set(["haiku"]);

export interface AgentConfig {
  model: string;
  effort: EffortLevel;
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
  mcpConfig: string;
}

export type SummarizerConfig = Omit<AgentConfig, "promptPath">;

export interface WorkerConfig {
  command: string;
  monitor: MonitorConfig;
  executor: ExecutorConfig;
  summarizer: SummarizerConfig;
  streamPartial: boolean;
  cwd: string;
  settingsFilePath: string;
  tasksFilePath: string;
  memoryDbPath: string;
  logsDir: string;
}

export type SessionFailureReason = "timeout" | "abort" | "isError" | "exit" | "spawn";

export interface RateLimitInfo {
  status: string;
  resetsAt?: number | undefined;
  rateLimitType?: string | undefined;
}

export interface SessionResult {
  ok: boolean;
  durationMs: number;
  costUsd?: number | undefined;
  numTurns?: number | undefined;
  sessionId?: string | undefined;
  resultText?: string | undefined;
  error?: string | undefined;
  failureReason?: SessionFailureReason | undefined;
  rateLimit?: RateLimitInfo | undefined;
}

export interface SessionSummary {
  costUsd?: number | undefined;
  numTurns?: number | undefined;
  sessionId?: string | undefined;
  isError?: boolean | undefined;
  resultText?: string | undefined;
  rateLimit?: RateLimitInfo | undefined;
}

export type TaskStatus = "pending" | "in_progress" | "done" | "failed" | "cancelled";

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
