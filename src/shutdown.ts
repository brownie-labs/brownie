import { logger } from "./logger.js";

export function abortOnSignals(
  signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"],
): AbortSignal {
  const controller = new AbortController();
  let shuttingDown = false;

  for (const signal of signals) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.warn(`Otrzymano ${signal} — zamykanie…`);
      controller.abort();
    });
  }

  return controller.signal;
}
