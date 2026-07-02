import { readFile } from "node:fs/promises";
import { runSession } from "../runner.js";
import type { SessionEventSink } from "../session-events.js";
import type { SummaryOutcome } from "../status.js";
import type { SessionResult, SummarizerConfig, Task } from "../types.js";
import type { MemoryStore } from "./store.js";
import { composeSummaryPrompt, parseSummary, SUMMARY_JSON_SCHEMA } from "./summary.js";

export interface TaskOutcomeContext {
  willRetry: boolean;
}

export interface TaskSummarizer {
  summarize(
    task: Task,
    result: SessionResult,
    outcome: TaskOutcomeContext,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface SummaryReporter {
  summaryStarted(task: Task): void;
  summaryFinished(outcome: Omit<SummaryOutcome, "finishedAt">): void;
  session: SessionEventSink;
}

export interface SessionSummarizerDeps {
  command: string;
  summarizer: SummarizerConfig;
  streamPartial: boolean;
  cwd: string;
  childEnv: NodeJS.ProcessEnv;
  store: MemoryStore;
  resolveLogPath(sessionId: string): Promise<string | undefined>;
  reporter: SummaryReporter;
}

export class SessionSummarizer implements TaskSummarizer {
  constructor(private readonly deps: SessionSummarizerDeps) {}

  async summarize(
    task: Task,
    result: SessionResult,
    outcome: TaskOutcomeContext,
    signal: AbortSignal,
  ): Promise<void> {
    const aborted = (): boolean => signal.aborted;
    if (aborted()) return;
    const { reporter, store, summarizer } = this.deps;
    reporter.summaryStarted(task);
    const startedAt = Date.now();
    const finished = (ok: boolean, error?: string, costUsd?: number): void => {
      reporter.summaryFinished({
        taskId: task.id,
        ok,
        durationMs: Date.now() - startedAt,
        costUsd,
        error,
      });
    };

    try {
      const sessionId = result.sessionId;
      if (sessionId === undefined) {
        finished(false, "executor session has no id — no log");
        return;
      }
      const logPath = await this.deps.resolveLogPath(sessionId);
      if (logPath === undefined) {
        finished(false, "executor session log file not found");
        return;
      }

      const systemPrompt = await readFile(summarizer.systemPromptPath, "utf8");
      const sessionResult = await runSession(
        {
          command: this.deps.command,
          model: summarizer.model,
          effort: summarizer.effort,
          systemPrompt,
          prompt: composeSummaryPrompt({
            task,
            result,
            willRetry: outcome.willRetry,
            logPath,
          }),
          sessionTimeoutMs: summarizer.sessionTimeoutMs,
          streamPartial: this.deps.streamPartial,
          jsonSchema: SUMMARY_JSON_SCHEMA,
          cwd: this.deps.cwd,
          childEnv: this.deps.childEnv,
          events: reporter.session,
        },
        signal,
      );
      if (aborted()) return;

      if (!sessionResult.ok) {
        finished(
          false,
          sessionResult.error ?? "unknown summarizer session error",
          sessionResult.costUsd,
        );
        return;
      }

      const report =
        sessionResult.resultText === undefined
          ? null
          : parseSummary(sessionResult.resultText);
      if (report === null) {
        finished(false, "invalid summary report", sessionResult.costUsd);
        return;
      }

      store.add({
        taskId: task.id,
        attempt: task.attempts,
        ok: result.ok,
        title: task.title,
        headline: report.headline,
        summary: report.summary,
        error: result.error,
        sessionId,
        createdAt: new Date().toISOString(),
      });
      finished(true, undefined, sessionResult.costUsd);
    } catch (err) {
      finished(false, err instanceof Error ? err.message : String(err));
    }
  }
}
