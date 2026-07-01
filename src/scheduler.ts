import { logger } from "./logger.js";
import { runSession } from "./runner.js";
import type { WorkerConfig } from "./types.js";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    if (signal.aborted) return resolvePromise();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolvePromise();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolvePromise();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function runScheduler(
  config: WorkerConfig,
  signal: AbortSignal,
): Promise<void> {
  logger.success(
    `Worker uruchomiony · komenda=${config.command} · model=${config.model} · interwał=${formatDuration(config.intervalMs)}`,
  );

  let session = 0;
  while (!signal.aborted) {
    session += 1;
    const start = Date.now();
    logger.start(`▶ Start sesji #${session} (komenda=${config.command}, model=${config.model})`);

    try {
      const result = await runSession(config, signal);
      if (signal.aborted) {
        logger.info(`⏹ Sesja #${session} przerwana (zamykanie).`);
        break;
      }
      if (result.ok) {
        logger.success(
          `✔ Koniec sesji #${session} · czas=${formatDuration(result.durationMs)}` +
            (result.costUsd != null ? ` · koszt=$${result.costUsd.toFixed(4)}` : "") +
            (result.numTurns != null ? ` · tury=${result.numTurns}` : ""),
        );
      } else {
        logger.error(
          `✖ Sesja #${session} niepowodzenie · czas=${formatDuration(result.durationMs)} · ${result.error}`,
        );
      }
    } catch (err) {
      logger.error(`✖ Sesja #${session} wyjątek:`, err);
    }

    if (signal.aborted) break;

    const wait = Math.max(0, config.intervalMs - (Date.now() - start));
    if (wait > 0) {
      logger.info(`⏳ Następna sesja za ${formatDuration(wait)}`);
      await sleep(wait, signal);
    } else {
      logger.info("⏭ Interwał przekroczony — kolejna sesja startuje natychmiast");
    }
  }

  logger.info("Scheduler zatrzymany.");
}
