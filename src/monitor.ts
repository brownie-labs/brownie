import { readFile } from "node:fs/promises";
import { msUntilActive } from "./active-hours.js";
import { parseTaskReport, TASK_REPORT_JSON_SCHEMA } from "./report.js";
import { runSession } from "./runner.js";
import type { MonitorReporter } from "./status.js";
import { sleep } from "./timing.js";
import type { TaskStore } from "./tasks.js";
import type { WorkerConfig } from "./types.js";
import type { Waker } from "./waker.js";

export async function runMonitorLoop(
  config: WorkerConfig,
  store: TaskStore,
  waker: Waker,
  reporter: MonitorReporter,
  signal: AbortSignal,
): Promise<void> {
  const { monitor } = config;
  const aborted = (): boolean => signal.aborted;

  let cycle = 0;
  while (!aborted()) {
    const now = new Date();
    const waitForWindow = msUntilActive(monitor.schedule, now);
    if (waitForWindow > 0) {
      reporter.offHours(new Date(now.getTime() + waitForWindow));
      await sleep(waitForWindow, signal);
      continue;
    }

    cycle += 1;
    const start = Date.now();
    reporter.cycleStarted(cycle);

    try {
      const [prompt, systemPrompt] = await Promise.all([
        readFile(monitor.promptPath, "utf8"),
        readFile(monitor.systemPromptPath, "utf8"),
      ]);

      const result = await runSession(
        {
          command: config.command,
          model: monitor.model,
          effort: monitor.effort,
          systemPrompt,
          prompt,
          sessionTimeoutMs: monitor.sessionTimeoutMs,
          streamPartial: config.streamPartial,
          jsonSchema: TASK_REPORT_JSON_SCHEMA,
          cwd: config.cwd,
          childEnv: config.childEnv,
          events: reporter.session,
        },
        signal,
      );

      if (aborted()) break;

      if (!result.ok) {
        reporter.cycleFinished({
          cycle,
          ok: false,
          durationMs: result.durationMs,
          costUsd: result.costUsd,
          addedTasks: 0,
          skippedDuplicates: 0,
          error: result.error ?? "nieznany błąd",
        });
      } else {
        const report =
          result.resultText === undefined ? null : parseTaskReport(result.resultText);
        if (report === null) {
          reporter.cycleFinished({
            cycle,
            ok: false,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
            addedTasks: 0,
            skippedDuplicates: 0,
            error: "niepoprawny raport zadań — cykl pominięty",
          });
        } else {
          const added = await store.addTasks(report);
          reporter.cycleFinished({
            cycle,
            ok: true,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
            addedTasks: added.length,
            skippedDuplicates: report.length - added.length,
          });
          if (added.length > 0) waker.notify();
        }
      }
    } catch (err) {
      reporter.cycleFinished({
        cycle,
        ok: false,
        durationMs: Date.now() - start,
        addedTasks: 0,
        skippedDuplicates: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (aborted()) break;

    const wait = monitor.intervalMs - (Date.now() - start);
    if (wait > 0) {
      reporter.sleepUntil(new Date(Date.now() + wait));
      await sleep(wait, signal);
    }
  }
}
