import { formatResume } from "../active-hours.js";
import type {
  ExecutorPhase,
  ExecutorTaskOutcome,
  MonitorCycleOutcome,
  MonitorPhase,
} from "../status.js";
import { formatDuration } from "../timing.js";

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
      return "uruchamianie…";
    case "offHours":
      return `⏸ poza godzinami pracy · wznowienie ${formatResume(new Date(phase.resumeAt))} (za ${formatCountdown(phase.resumeAt - now)})`;
    case "session":
      return `▶ cykl #${phase.cycle} · trwa ${formatDuration(now - phase.startedAt)}`;
    case "sleeping":
      return `⏳ następny cykl za ${formatCountdown(phase.nextCycleAt - now)}`;
  }
}

export function formatExecutorPhase(phase: ExecutorPhase, now: number): string {
  switch (phase.kind) {
    case "waiting":
      return "⏳ oczekiwanie na zadania";
    case "session":
      return `▶ ${phase.task.id}: ${phase.task.title} · trwa ${formatDuration(now - phase.startedAt)}`;
    case "summary":
      return `✎ podsumowanie ${phase.task.id} do pamięci · trwa ${formatDuration(now - phase.startedAt)}`;
    case "backoff":
      return `↻ ponowienie ${phase.task.id} za ${formatCountdown(phase.resumeAt - now)}`;
  }
}

function formatCost(costUsd: number | undefined): string {
  return costUsd != null ? ` · koszt=$${costUsd.toFixed(4)}` : "";
}

export function formatMonitorOutcome(outcome: MonitorCycleOutcome): string {
  const base = `cykl #${outcome.cycle} · czas=${formatDuration(outcome.durationMs)}${formatCost(outcome.costUsd)}`;
  if (!outcome.ok) return `✖ ${base} · ${outcome.error ?? "nieznany błąd"}`;
  const duplicates =
    outcome.skippedDuplicates > 0
      ? ` · pominięte duplikaty: ${outcome.skippedDuplicates}`
      : "";
  return `✔ ${base} · nowe zadania: ${outcome.addedTasks}${duplicates}`;
}

export function formatExecutorOutcome(outcome: ExecutorTaskOutcome): string {
  const base = `${outcome.taskId} · czas=${formatDuration(outcome.durationMs)}${formatCost(outcome.costUsd)}`;
  if (outcome.willRetry) {
    const attempts =
      outcome.attempt != null && outcome.maxAttempts != null
        ? ` · ponowienie (próba ${outcome.attempt}/${outcome.maxAttempts})`
        : " · ponowienie";
    return `↻ ${base} · ${outcome.error ?? "nieznany błąd"}${attempts}`;
  }
  if (!outcome.ok) return `✖ ${base} · ${outcome.error ?? "nieznany błąd"}`;
  const turns = outcome.numTurns != null ? ` · tury=${outcome.numTurns}` : "";
  return `✔ ${base}${turns}`;
}
