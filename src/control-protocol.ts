import type { AgentControlState } from "./control.js";
import type {
  ExecutorPhase,
  ExecutorTaskOutcome,
  MonitorCycleOutcome,
  MonitorPhase,
  WorkerStats,
  WorkerStatus,
} from "./status.js";
import type { TaskStatus } from "./types.js";

export const CONTROL_TARGETS = ["monitor", "executor", "all"] as const;

export type ControlTarget = (typeof CONTROL_TARGETS)[number];

export type ControlRequest =
  | { cmd: "status" }
  | { cmd: "pause"; agent: ControlTarget }
  | { cmd: "resume"; agent: ControlTarget };

export interface ControlPhase {
  kind: string;
  since?: string | undefined;
  until?: string | undefined;
  cycle?: number | undefined;
  taskId?: string | undefined;
  title?: string | undefined;
}

export interface ControlAgentStatus<Outcome> {
  phase: ControlPhase;
  control: AgentControlState;
  recentOutcomes: Outcome[];
}

export interface ControlStatus {
  version: string;
  pid: number;
  startedAt: string;
  projectDir: string;
  headless: boolean;
  agents: {
    monitor: ControlAgentStatus<MonitorCycleOutcome>;
    executor: ControlAgentStatus<ExecutorTaskOutcome>;
  };
  stats: WorkerStats;
  taskCounts: Record<TaskStatus, number>;
}

export interface ControlResponse {
  ok: boolean;
  data?: ControlStatus | undefined;
  error?: string | undefined;
}

export function parseControlRequest(line: string): ControlRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.cmd === "status") return { cmd: "status" };
  if (record.cmd === "pause" || record.cmd === "resume") {
    const agent = record.agent;
    if (
      typeof agent === "string" &&
      (CONTROL_TARGETS as readonly string[]).includes(agent)
    ) {
      return { cmd: record.cmd, agent: agent as ControlTarget };
    }
  }
  return null;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function serializeMonitorPhase(phase: MonitorPhase): ControlPhase {
  switch (phase.kind) {
    case "starting":
      return { kind: phase.kind };
    case "offHours":
    case "limitWait":
      return { kind: phase.kind, until: iso(phase.resumeAt) };
    case "session":
      return { kind: phase.kind, since: iso(phase.startedAt), cycle: phase.cycle };
    case "sleeping":
      return { kind: phase.kind, until: iso(phase.nextCycleAt) };
  }
}

function serializeExecutorPhase(phase: ExecutorPhase): ControlPhase {
  switch (phase.kind) {
    case "waiting":
      return { kind: phase.kind };
    case "limitWait":
      return { kind: phase.kind, until: iso(phase.resumeAt) };
    case "session":
    case "summary":
      return {
        kind: phase.kind,
        since: iso(phase.startedAt),
        taskId: phase.task.id,
        title: phase.task.title,
      };
    case "backoff":
      return {
        kind: phase.kind,
        until: iso(phase.resumeAt),
        taskId: phase.task.id,
        title: phase.task.title,
      };
  }
}

const RECENT_OUTCOMES_IN_STATUS = 5;

export interface ControlStatusContext {
  snapshot: WorkerStatus;
  version: string;
  pid: number;
  projectDir: string;
  headless: boolean;
}

export function buildControlStatus(context: ControlStatusContext): ControlStatus {
  const { snapshot } = context;
  const taskCounts: Record<TaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const task of snapshot.tasks) taskCounts[task.status] += 1;
  return {
    version: context.version,
    pid: context.pid,
    startedAt: iso(snapshot.startedAt),
    projectDir: context.projectDir,
    headless: context.headless,
    agents: {
      monitor: {
        phase: serializeMonitorPhase(snapshot.monitor.phase),
        control: snapshot.monitor.control,
        recentOutcomes: snapshot.monitor.recentOutcomes.slice(
          0,
          RECENT_OUTCOMES_IN_STATUS,
        ),
      },
      executor: {
        phase: serializeExecutorPhase(snapshot.executor.phase),
        control: snapshot.executor.control,
        recentOutcomes: snapshot.executor.recentOutcomes.slice(
          0,
          RECENT_OUTCOMES_IN_STATUS,
        ),
      },
    },
    stats: snapshot.stats,
    taskCounts,
  };
}
