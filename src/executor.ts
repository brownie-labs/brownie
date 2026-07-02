import { readFile } from "node:fs/promises";
import { runSession } from "./runner.js";
import type { ExecutorReporter } from "./status.js";
import { sleep } from "./timing.js";
import type { TaskStore } from "./tasks.js";
import type { SessionResult, Task, WorkerConfig } from "./types.js";
import type { Waker } from "./waker.js";

export const TASK_EXECUTION_CONTRACT = `## Kontrakt wykonania (techniczny, nadrzędny)

Pracujesz nad dokładnie jednym zadaniem — opisanym w sekcji „Zadanie do wykonania".
Nie podejmuj innych zadań, nawet jeśli je zauważysz — zajmą się nimi osobne sesje.
Wykonuj pracę tak, aby jej powtórzenie było bezpieczne (idempotentnie) — sesja może
zostać przerwana i uruchomiona ponownie.`;

const TRANSIENT_RESULT_PATTERN =
  /API Error|Connection (closed|error|reset)|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|socket hang up|overloaded|rate.?limit|Request timed out/i;

export function isTransientFailure(result: SessionResult): boolean {
  if (result.failureReason === "timeout") return true;
  if (result.failureReason !== "isError") return false;
  return TRANSIENT_RESULT_PATTERN.test(result.resultText ?? "");
}

export function composeTaskPrompt(prompt: string, task: Task): string {
  return `${prompt.trimEnd()}

## Zadanie do wykonania

ID: ${task.id}
Tytuł: ${task.title}
Opis:
${task.description}
`;
}

export async function runExecutorLoop(
  config: WorkerConfig,
  store: TaskStore,
  waker: Waker,
  reporter: ExecutorReporter,
  signal: AbortSignal,
): Promise<void> {
  const { executor } = config;
  const aborted = (): boolean => signal.aborted;

  while (!aborted()) {
    const task = await store.takeNext();
    if (!task) {
      reporter.waiting();
      await waker.wait(signal);
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
          systemPrompt: `${systemPrompt}\n\n${TASK_EXECUTION_CONTRACT}`,
          prompt: composeTaskPrompt(prompt, task),
          sessionTimeoutMs: executor.sessionTimeoutMs,
          streamPartial: config.streamPartial,
          cwd: config.cwd,
          childEnv: config.childEnv,
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
      } else {
        const error = result.error ?? "nieznany błąd";
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
        if (willRetry && executor.retryDelayMs > 0) {
          reporter.retryScheduled(task, new Date(Date.now() + executor.retryDelayMs));
          await sleep(executor.retryDelayMs, signal);
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
