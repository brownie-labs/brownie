import type { SummaryReporter } from "../memory/summarizer.js";
import { describeToolUse, truncate, type SessionEventSink } from "../session-events.js";
import type { ExecutorReporter, MonitorReporter } from "../status.js";
import { compactFields, type HeadlessAgent, type HeadlessLogEmitter } from "./events.js";

export interface HeadlessReporterOptions {
  verbose?: boolean | undefined;
}

export interface HeadlessReporters {
  monitor: MonitorReporter;
  executor: ExecutorReporter;
  summarizer: SummaryReporter;
}

function sessionSink(
  emit: HeadlessLogEmitter,
  agent: HeadlessAgent,
  verbose: boolean,
): SessionEventSink {
  return (event) => {
    switch (event.type) {
      case "init":
        emit({
          level: "info",
          agent,
          event: "session.init",
          fields: { model: event.model, sessionId: event.sessionId },
        });
        return;
      case "stderr":
        emit({
          level: "warn",
          agent,
          event: "session.stderr",
          fields: { line: event.line },
        });
        return;
      case "procError":
        emit({
          level: "error",
          agent,
          event: "session.procError",
          fields: { message: event.message },
        });
        return;
      case "killing":
        emit({
          level: "warn",
          agent,
          event: "session.killed",
          fields: { reason: event.reason },
        });
        return;
      case "text":
        if (verbose) {
          emit({
            level: "info",
            agent,
            event: "session.text",
            fields: { text: truncate(event.text) },
          });
        }
        return;
      case "toolUse":
        if (verbose) {
          const call = describeToolUse(event.name, event.input);
          emit({
            level: "info",
            agent,
            event: "session.tool",
            fields: { tool: call.name, detail: call.detail },
          });
        }
        return;
      case "toolResult":
        if (verbose && event.isError) {
          emit({
            level: "warn",
            agent,
            event: "session.toolError",
            fields: { output: truncate(event.lines.join(" ")) },
          });
        }
        return;
      case "partial":
      case "raw":
        return;
    }
  };
}

export function createHeadlessReporters(
  emit: HeadlessLogEmitter,
  options: HeadlessReporterOptions = {},
): HeadlessReporters {
  const verbose = options.verbose === true;

  const monitor: MonitorReporter = {
    offHours: (resumeAt) => {
      emit({
        level: "info",
        agent: "monitor",
        event: "monitor.offHours",
        fields: { resumeAt: resumeAt.toISOString() },
      });
    },
    usageLimit: (resumeAt) => {
      emit({
        level: "warn",
        agent: "monitor",
        event: "monitor.limitWait",
        fields: { resumeAt: resumeAt.toISOString() },
      });
    },
    cycleStarted: (cycle) => {
      emit({
        level: "info",
        agent: "monitor",
        event: "cycle.started",
        fields: { cycle },
      });
    },
    cycleFinished: (outcome) => {
      emit({
        level: outcome.ok ? "info" : "error",
        agent: "monitor",
        event: "cycle.finished",
        fields: compactFields({
          cycle: outcome.cycle,
          ok: outcome.ok,
          durationMs: outcome.durationMs,
          costUsd: outcome.costUsd,
          addedTasks: outcome.addedTasks,
          skippedDuplicates: outcome.skippedDuplicates,
          error: outcome.error,
        }),
      });
    },
    sleepUntil: (nextCycleAt) => {
      emit({
        level: "info",
        agent: "monitor",
        event: "monitor.sleeping",
        fields: { nextCycleAt: nextCycleAt.toISOString() },
      });
    },
    session: sessionSink(emit, "monitor", verbose),
  };

  const executor: ExecutorReporter = {
    taskStarted: (task) => {
      emit({
        level: "info",
        agent: "executor",
        event: "task.started",
        fields: { taskId: task.id, title: task.title },
      });
    },
    taskFinished: (outcome) => {
      emit({
        level: outcome.ok ? "info" : outcome.willRetry === true ? "warn" : "error",
        agent: "executor",
        event: "task.finished",
        fields: compactFields({
          taskId: outcome.taskId,
          title: outcome.title,
          ok: outcome.ok,
          durationMs: outcome.durationMs,
          costUsd: outcome.costUsd,
          numTurns: outcome.numTurns,
          willRetry: outcome.willRetry,
          attempt: outcome.attempt,
          maxAttempts: outcome.maxAttempts,
          error: outcome.error,
        }),
      });
    },
    retryScheduled: (task, resumeAt) => {
      emit({
        level: "warn",
        agent: "executor",
        event: "task.retryScheduled",
        fields: { taskId: task.id, resumeAt: resumeAt.toISOString() },
      });
    },
    usageLimit: (resumeAt) => {
      emit({
        level: "warn",
        agent: "executor",
        event: "executor.limitWait",
        fields: { resumeAt: resumeAt.toISOString() },
      });
    },
    waiting: () => {
      emit({
        level: "info",
        agent: "executor",
        event: "executor.waiting",
        fields: {},
      });
    },
    summaryStarted: () => undefined,
    summaryFinished: () => undefined,
    session: sessionSink(emit, "executor", verbose),
  };

  const summarizer: SummaryReporter = {
    summaryStarted: (task) => {
      emit({
        level: "info",
        agent: "summarizer",
        event: "summary.started",
        fields: { taskId: task.id },
      });
    },
    summaryFinished: (outcome) => {
      emit({
        level: outcome.ok ? "info" : "error",
        agent: "summarizer",
        event: "summary.finished",
        fields: compactFields({
          taskId: outcome.taskId,
          ok: outcome.ok,
          durationMs: outcome.durationMs,
          costUsd: outcome.costUsd,
          error: outcome.error,
        }),
      });
    },
    session: sessionSink(emit, "summarizer", verbose),
  };

  return { monitor, executor, summarizer };
}
