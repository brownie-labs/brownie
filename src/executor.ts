import { readFile } from "node:fs/promises";
import { executorLogger } from "./logger.js";
import { runSession } from "./runner.js";
import { formatDuration } from "./timing.js";
import type { TaskStore } from "./tasks.js";
import type { Task, WorkerConfig } from "./types.js";
import type { Waker } from "./waker.js";

export const TASK_EXECUTION_CONTRACT = `## Kontrakt wykonania (techniczny, nadrzędny)

Pracujesz nad dokładnie jednym zadaniem — opisanym w sekcji „Zadanie do wykonania".
Nie podejmuj innych zadań, nawet jeśli je zauważysz — zajmą się nimi osobne sesje.
Wykonuj pracę tak, aby jej powtórzenie było bezpieczne (idempotentnie) — sesja może
zostać przerwana i uruchomiona ponownie.`;

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
  signal: AbortSignal,
): Promise<void> {
  const { executor } = config;
  executorLogger.success(
    `Egzekutor uruchomiony · model=${executor.model} · oczekujące zadania: ${store.pendingCount()}`,
  );

  const aborted = (): boolean => signal.aborted;

  while (!aborted()) {
    const task = await store.takeNext();
    if (!task) {
      await waker.wait(signal);
      continue;
    }

    executorLogger.start(`▶ Zadanie ${task.id}: ${task.title}`);

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
          permissionMode: executor.permissionMode,
          sessionTimeoutMs: executor.sessionTimeoutMs,
          streamPartial: config.streamPartial,
          cwd: config.cwd,
          childEnv: config.childEnv,
          log: executorLogger,
        },
        signal,
      );

      if (aborted()) {
        executorLogger.info(`⏹ Zadanie ${task.id} przerwane (zamykanie).`);
        break;
      }

      if (result.ok) {
        await store.complete(task.id);
        executorLogger.success(
          `✔ Zadanie ${task.id} wykonane · czas=${formatDuration(result.durationMs)}` +
            (result.costUsd != null ? ` · koszt=$${result.costUsd.toFixed(4)}` : "") +
            (result.numTurns != null ? ` · tury=${result.numTurns}` : ""),
        );
      } else {
        await store.fail(task.id, result.error ?? "nieznany błąd");
        executorLogger.error(
          `✖ Zadanie ${task.id} niepowodzenie · czas=${formatDuration(result.durationMs)} · ${result.error ?? "nieznany błąd"}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.fail(task.id, message);
      executorLogger.error(`✖ Zadanie ${task.id} wyjątek:`, err);
    }
  }

  executorLogger.info("Egzekutor zatrzymany.");
}
