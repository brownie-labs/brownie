import { readFile } from "node:fs/promises";
import { msUntilActive } from "./active-hours.js";
import { detectAuthFailure } from "./auth-gate.js";
import { createContextFileAccess } from "./context-file.js";
import type { AgentController } from "./control.js";
import type { LoopGates } from "./gates.js";
import { writeMcpConfig } from "./mcp-config.js";
import { composePrompt } from "./prompt-compose.js";
import { parseTaskReport, TASK_REPORT_JSON_SCHEMA } from "./report.js";
import { runSession } from "./runner.js";
import type { MonitorReporter } from "./status.js";
import type { TaskStore } from "./tasks.js";
import type { WorkerConfig } from "./types.js";
import { detectUsageLimit } from "./usage-limit.js";
import type { Waker } from "./waker.js";

export async function runMonitorLoop(
  config: WorkerConfig,
  store: TaskStore,
  waker: Waker,
  reporter: MonitorReporter,
  controller: AgentController,
  gates: LoopGates,
  signal: AbortSignal,
): Promise<void> {
  const { monitor } = config;
  const contextFile = createContextFileAccess(config.contextFilePath);
  const aborted = (): boolean => signal.aborted;

  let cycle = 0;
  while (!aborted()) {
    const authBlock = gates.auth.blocked;
    if (authBlock !== null) reporter.authBlocked(authBlock);
    await controller.gate(signal);
    if (aborted()) break;

    const now = new Date();
    const waitForWindow = msUntilActive(monitor.schedule, now);
    if (waitForWindow > 0) {
      reporter.offHours(new Date(now.getTime() + waitForWindow));
      await controller.sleep(waitForWindow, signal);
      continue;
    }

    const limitWaitMs = gates.limit.msRemaining(now.getTime());
    if (limitWaitMs > 0) {
      reporter.usageLimit(new Date(now.getTime() + limitWaitMs));
      await controller.sleep(limitWaitMs, signal);
      continue;
    }

    cycle += 1;
    const start = Date.now();
    reporter.cycleStarted(cycle);

    try {
      const [prompt, systemPrompt, context, mcpConfigPath] = await Promise.all([
        readFile(monitor.promptPath, "utf8"),
        readFile(monitor.systemPromptPath, "utf8"),
        contextFile.read(),
        writeMcpConfig(config.dataDir, {
          role: "monitor",
          servers: config.mcpServers,
          selected: monitor.mcpServers,
          browser: config.browser,
          memoryDbPath: null,
          playwrightOutputDir: config.playwrightOutputDir,
        }),
      ]);

      const result = await runSession(
        {
          command: config.command,
          model: monitor.model,
          effort: monitor.effort,
          systemPrompt,
          prompt: composePrompt(prompt, context),
          sessionTimeoutMs: monitor.sessionTimeoutMs,
          streamPartial: config.streamPartial,
          mcpConfigPath,
          jsonSchema: TASK_REPORT_JSON_SCHEMA,
          cwd: config.cwd,
          events: reporter.session,
        },
        signal,
      );

      if (aborted()) break;

      if (!result.ok) {
        const auth = detectAuthFailure(result);
        if (auth) {
          gates.auth.engage(auth);
          reporter.cycleFinished({
            cycle,
            ok: false,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
            addedTasks: 0,
            skippedDuplicates: 0,
            error: `authentication failed — ${auth.reason}`,
          });
          continue;
        }
        const limit = detectUsageLimit(result);
        if (limit) gates.limit.engage(limit, Date.now());
        reporter.cycleFinished({
          cycle,
          ok: false,
          durationMs: result.durationMs,
          costUsd: result.costUsd,
          addedTasks: 0,
          skippedDuplicates: 0,
          error: limit ? "usage limit reached" : (result.error ?? "unknown error"),
        });
        if (limit) continue;
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
            error: "invalid task report — cycle skipped",
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
      await controller.sleep(wait, signal);
    }
  }
}
