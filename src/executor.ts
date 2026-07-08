import { readFile } from "node:fs/promises";
import type { AgentController } from "./control.js";
import type { TaskSummarizer } from "./memory/summarizer.js";
import { runSession } from "./runner.js";
import type { ExecutorReporter } from "./status.js";
import type { TaskStore } from "./tasks.js";
import type { SessionResult, Task, WorkerConfig } from "./types.js";
import { detectUsageLimit, type UsageLimitGate } from "./usage-limit.js";
import type { Waker } from "./waker.js";

const TRANSIENT_RESULT_PATTERN =
  /API Error|Connection (closed|error|reset)|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|socket hang up|overloaded|rate.?limit|Request timed out/i;

export function isTransientFailure(result: SessionResult): boolean {
  if (result.failureReason === "timeout") return true;
  if (result.failureReason !== "isError") return false;
  return TRANSIENT_RESULT_PATTERN.test(result.resultText ?? "");
}

export function composeTaskPrompt(prompt: string, task: Task): string {
  return `${prompt.trimEnd()}

## Task to complete

ID: ${task.id}
Title: ${task.title}
Description:
${task.description}
`;
}

export async function runExecutorLoop(
  config: WorkerConfig,
  store: TaskStore,
  waker: Waker,
  reporter: ExecutorReporter,
  summarizer: TaskSummarizer,
  controller: AgentController,
  limitGate: UsageLimitGate,
  signal: AbortSignal,
): Promise<void> {
  const { executor } = config;
  const aborted = (): boolean => signal.aborted;

  while (!aborted()) {
    await controller.gate(signal);
    if (aborted()) break;

    const limitWaitMs = limitGate.msRemaining(Date.now());
    if (limitWaitMs > 0) {
      reporter.usageLimit(new Date(Date.now() + limitWaitMs));
      await controller.sleep(limitWaitMs, signal);
      continue;
    }

    const task = await store.takeNext();
    if (!task) {
      reporter.waiting();
      await Promise.race([waker.wait(signal), controller.pauseRequested(signal)]);
      continue;
    }

    reporter.taskStarted(task);
    const start = Date.now();

    try {
      const [prompt, systemPrompt] = await Promise.all([
        readFile(executor.promptPath, "utf8"),
        readFile(executor.systemPromptPath, "utf8"),
      ]);

      const result = await runSession(
        {
          command: config.command,
          model: executor.model,
          effort: executor.effort,
          systemPrompt,
          prompt: composeTaskPrompt(prompt, task),
          sessionTimeoutMs: executor.sessionTimeoutMs,
          streamPartial: config.streamPartial,
          mcpConfig: executor.mcpConfig,
          cwd: config.cwd,
          events: reporter.session,
        },
        signal,
      );

      if (aborted()) break;

      if (result.ok) {
        await store.complete(task.id);
        reporter.taskFinished({
          taskId: task.id,
          title: task.title,
          ok: true,
          durationMs: result.durationMs,
          costUsd: result.costUsd,
          numTurns: result.numTurns,
        });
        await summarizer
          .summarize(task, result, { willRetry: false }, signal)
          .catch(() => undefined);
      } else {
        const error = result.error ?? "unknown error";
        const limit = detectUsageLimit(result);
        if (limit) {
          limitGate.engage(limit, Date.now());
          await store.release(task.id, "usage limit reached");
          reporter.taskFinished({
            taskId: task.id,
            title: task.title,
            ok: false,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
            numTurns: result.numTurns,
            error: "usage limit reached — task requeued",
            willRetry: true,
          });
          continue;
        }
        const willRetry =
          isTransientFailure(result) && task.attempts < executor.maxTaskAttempts;
        if (willRetry) {
          await store.requeue(task.id, error);
        } else {
          await store.fail(task.id, error);
        }
        reporter.taskFinished({
          taskId: task.id,
          title: task.title,
          ok: false,
          durationMs: result.durationMs,
          costUsd: result.costUsd,
          numTurns: result.numTurns,
          error,
          willRetry,
          attempt: task.attempts,
          maxAttempts: executor.maxTaskAttempts,
        });
        await summarizer
          .summarize(task, result, { willRetry }, signal)
          .catch(() => undefined);
        if (willRetry && executor.retryDelayMs > 0) {
          reporter.retryScheduled(task, new Date(Date.now() + executor.retryDelayMs));
          await controller.sleep(executor.retryDelayMs, signal);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.fail(task.id, message);
      reporter.taskFinished({
        taskId: task.id,
        title: task.title,
        ok: false,
        durationMs: Date.now() - start,
        error: message,
      });
    }
  }
}
