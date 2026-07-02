export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    if (signal.aborted) {
      resolvePromise();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolvePromise();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolvePromise();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
