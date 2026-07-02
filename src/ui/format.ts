import { formatResume } from "../active-hours.js";
import type {
  ExecutorPhase,
  ExecutorTaskOutcome,
  MonitorCycleOutcome,
  MonitorPhase,
  WorkerStats,
} from "../status.js";
import { formatDuration } from "../timing.js";

const STALL_THRESHOLD_MS = 120_000;

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

export function formatInterval(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} h`);
  if (m > 0) parts.push(`${m} min`);
  if (s > 0 || parts.length === 0) parts.push(`${s} s`);
  return parts.join(" ");
}

export function formatMonitorPhase(phase: MonitorPhase, now: number): string {
  switch (phase.kind) {
    case "starting":
      return "starting…";
    case "offHours":
      return `⏸ outside working hours · resume ${formatResume(new Date(phase.resumeAt))} (in ${formatCountdown(phase.resumeAt - now)})`;
    case "session":
      return `▶ cycle #${phase.cycle} · running ${formatDuration(now - phase.startedAt)}`;
    case "sleeping":
      return `⏳ next cycle in ${formatCountdown(phase.nextCycleAt - now)}`;
  }
}

export function formatExecutorPhase(phase: ExecutorPhase, now: number): string {
  switch (phase.kind) {
    case "waiting":
      return "⏳ waiting for tasks";
    case "session":
      return `▶ ${phase.task.id}: ${phase.task.title} · running ${formatDuration(now - phase.startedAt)}`;
    case "summary":
      return `✎ summarizing ${phase.task.id} to memory · running ${formatDuration(now - phase.startedAt)}`;
    case "backoff":
      return `↻ retrying ${phase.task.id} in ${formatCountdown(phase.resumeAt - now)}`;
  }
}

export function detectStall(
  startedAt: number,
  lastEventAt: number | undefined,
  now: number,
): string | undefined {
  const idleMs = now - (lastEventAt ?? startedAt);
  if (idleMs < STALL_THRESHOLD_MS) return undefined;
  return `⚠ no output for ${formatInterval(idleMs)}`;
}

export function formatStats(stats: WorkerStats, uptimeMs: number): string {
  return (
    `uptime ${formatInterval(uptimeMs)} · cycles ${stats.cycles}` +
    ` · tasks ✔${stats.tasksSucceeded} ✖${stats.tasksFailed}` +
    ` · cost $${stats.totalCostUsd.toFixed(2)}`
  );
}

export function formatAge(isoDate: string, now: number): string {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCost(costUsd: number | undefined): string {
  return costUsd != null ? ` · cost=$${costUsd.toFixed(4)}` : "";
}

export function formatMonitorOutcome(outcome: MonitorCycleOutcome): string {
  const base = `cycle #${outcome.cycle} · time=${formatDuration(outcome.durationMs)}${formatCost(outcome.costUsd)}`;
  if (!outcome.ok) return `✖ ${base} · ${outcome.error ?? "unknown error"}`;
  const duplicates =
    outcome.skippedDuplicates > 0
      ? ` · skipped duplicates: ${outcome.skippedDuplicates}`
      : "";
  return `✔ ${base} · new tasks: ${outcome.addedTasks}${duplicates}`;
}

export function formatExecutorOutcome(outcome: ExecutorTaskOutcome): string {
  const base = `${outcome.taskId} · time=${formatDuration(outcome.durationMs)}${formatCost(outcome.costUsd)}`;
  if (outcome.willRetry) {
    const attempts =
      outcome.attempt != null && outcome.maxAttempts != null
        ? ` · retry (attempt ${outcome.attempt}/${outcome.maxAttempts})`
        : " · retry";
    return `↻ ${base} · ${outcome.error ?? "unknown error"}${attempts}`;
  }
  if (!outcome.ok) return `✖ ${base} · ${outcome.error ?? "unknown error"}`;
  const turns = outcome.numTurns != null ? ` · turns=${outcome.numTurns}` : "";
  return `✔ ${base}${turns}`;
}
