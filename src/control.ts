import { sleep } from "./timing.js";

export type AgentControlState = "running" | "pausing" | "paused";

type Wake = () => void;

class WaitList {
  private waiters: Wake[] = [];

  wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wakeWaiter of waiters) wakeWaiter();
  }

  add(wake: Wake): void {
    this.waiters.push(wake);
  }

  remove(wake: Wake): void {
    this.waiters = this.waiters.filter((waiter) => waiter !== wake);
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
        this.remove(wake);
        resolvePromise();
      };
      this.add(wake);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export class AgentController {
  private current: AgentControlState;
  private readonly gateOpened = new WaitList();
  private readonly pauseAsked = new WaitList();

  constructor(
    private readonly onChange: (state: AgentControlState) => void,
    initialState: AgentControlState = "running",
  ) {
    this.current = initialState;
  }

  get state(): AgentControlState {
    return this.current;
  }

  pause(): boolean {
    if (this.current !== "running") return false;
    this.setState("pausing");
    this.pauseAsked.wake();
    return true;
  }

  resume(): boolean {
    if (this.current === "running") return false;
    this.setState("running");
    this.gateOpened.wake();
    return true;
  }

  gate(signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.current === "running") return Promise.resolve();
    this.setState("paused");
    return this.gateOpened.wait(signal);
  }

  pauseRequested(signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.current !== "running") return Promise.resolve();
    return this.pauseAsked.wait(signal);
  }

  async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.current !== "running") return;
    const linked = new AbortController();
    const wake = (): void => {
      linked.abort();
    };
    const onAbort = (): void => {
      this.pauseAsked.remove(wake);
      linked.abort();
    };
    this.pauseAsked.add(wake);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await sleep(ms, linked.signal);
    } finally {
      this.pauseAsked.remove(wake);
      signal.removeEventListener("abort", onAbort);
    }
  }

  private setState(state: AgentControlState): void {
    this.current = state;
    this.onChange(state);
  }
}
