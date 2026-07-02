import { readFile } from "node:fs/promises";
import { describeSchedule, formatResume, msUntilActive } from "./active-hours.js";
import { monitorLogger } from "./logger.js";
import { parseTaskReport, TASK_REPORT_CONTRACT } from "./report.js";
import { runSession } from "./runner.js";
import { formatDuration, sleep } from "./timing.js";
import type { TaskStore } from "./tasks.js";
import type { WorkerConfig } from "./types.js";
import type { Waker } from "./waker.js";

export async function runMonitorLoop(
  config: WorkerConfig,
  store: TaskStore,
  waker: Waker,
  signal: AbortSignal,
): Promise<void> {
  const { monitor } = config;
  monitorLogger.success(
    `Monitor uruchomiony · model=${monitor.model} · interwał=${formatDuration(monitor.intervalMs)}` +
      ` · godziny pracy=${describeSchedule(monitor.schedule)}`,
  );

  const aborted = (): boolean => signal.aborted;

  let cycle = 0;
  while (!aborted()) {
    const now = new Date();
    const waitForWindow = msUntilActive(monitor.schedule, now);
    if (waitForWindow > 0) {
      monitorLogger.info(
        `⏸ Poza godzinami pracy monitora — wznowienie ${formatResume(new Date(now.getTime() + waitForWindow))}`,
      );
      await sleep(waitForWindow, signal);
      continue;
    }

    cycle += 1;
    const start = Date.now();
    monitorLogger.start(`▶ Cykl #${cycle} — sprawdzam, czy jest coś do zrobienia`);

    try {
      const [prompt, systemPrompt] = await Promise.all([
        readFile(monitor.promptPath, "utf8"),
        readFile(monitor.systemPromptPath, "utf8"),
      ]);

      const result = await runSession(
        {
          command: config.command,
          model: monitor.model,
          systemPrompt: `${systemPrompt}\n\n${TASK_REPORT_CONTRACT}`,
          prompt,
          sessionTimeoutMs: monitor.sessionTimeoutMs,
          streamPartial: config.streamPartial,
          cwd: config.cwd,
          childEnv: config.childEnv,
          log: monitorLogger,
        },
        signal,
      );

      if (aborted()) {
        monitorLogger.info(`⏹ Cykl #${cycle} przerwany (zamykanie).`);
        break;
      }

      if (!result.ok) {
        monitorLogger.error(
          `✖ Cykl #${cycle} niepowodzenie · czas=${formatDuration(result.durationMs)} · ${result.error ?? "nieznany błąd"}`,
        );
      } else {
        const report =
          result.resultText === undefined ? null : parseTaskReport(result.resultText);
        if (report === null) {
          monitorLogger.error(
            `✖ Cykl #${cycle}: monitor zwrócił niepoprawny raport zadań — pomijam ten cykl`,
          );
          monitorLogger.debug(`raport: ${result.resultText?.slice(0, 500) ?? "(brak)"}`);
        } else {
          const added = await store.addTasks(report);
          const skipped = report.length - added.length;
          monitorLogger.success(
            `✔ Cykl #${cycle} · czas=${formatDuration(result.durationMs)}` +
              (result.costUsd != null ? ` · koszt=$${result.costUsd.toFixed(4)}` : "") +
              ` · nowe zadania: ${added.length}` +
              (skipped > 0 ? ` · pominięte duplikaty: ${skipped}` : ""),
          );
          if (added.length > 0) {
            for (const task of added) {
              monitorLogger.info(`＋ ${task.id}: ${task.title}`);
            }
            waker.notify();
          }
        }
      }
    } catch (err) {
      monitorLogger.error(`✖ Cykl #${cycle} wyjątek:`, err);
    }

    if (aborted()) break;

    const wait = monitor.intervalMs - (Date.now() - start);
    if (wait > 0) {
      monitorLogger.info(`⏳ Następny cykl za ${formatDuration(wait)}`);
      await sleep(wait, signal);
    } else if (wait < 0) {
      monitorLogger.info("⏭ Interwał przekroczony — kolejny cykl startuje natychmiast");
    }
  }

  monitorLogger.info("Monitor zatrzymany.");
}
