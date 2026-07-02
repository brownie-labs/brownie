export function abortOnSignals(
  onSignal?: (signal: NodeJS.Signals) => void,
  signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"],
): AbortSignal {
  const controller = new AbortController();
  let shuttingDown = false;

  for (const signal of signals) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      onSignal?.(signal);
      controller.abort();
    });
  }

  return controller.signal;
}
