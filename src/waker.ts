export class Waker {
  private waiters: (() => void)[] = [];

  notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolvePromise) => {
      if (signal.aborted) {
        resolvePromise();
        return;
      }
      const wake = (): void => {
        signal.removeEventListener("abort", onAbort);
        resolvePromise();
      };
      const onAbort = (): void => {
        this.waiters = this.waiters.filter((waiter) => waiter !== wake);
        resolvePromise();
      };
      this.waiters.push(wake);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
