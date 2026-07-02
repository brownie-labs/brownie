import { afterEach, describe, expect, it, vi } from "vitest";
import { abortOnSignals } from "../src/shutdown.js";

const SIGNAL: NodeJS.Signals = "SIGUSR2";

describe("abortOnSignals", () => {
  afterEach(() => {
    process.removeAllListeners(SIGNAL);
  });

  it("is not aborted before a signal arrives", () => {
    const signal = abortOnSignals(undefined, [SIGNAL]);
    expect(signal.aborted).toBe(false);
  });

  it("on a signal sets abort and calls the callback with the signal name", () => {
    const onSignal = vi.fn();
    const signal = abortOnSignals(onSignal, [SIGNAL]);
    process.emit(SIGNAL);
    expect(signal.aborted).toBe(true);
    expect(onSignal).toHaveBeenCalledWith(SIGNAL);
  });

  it("works without a callback", () => {
    const signal = abortOnSignals(undefined, [SIGNAL]);
    process.emit(SIGNAL);
    expect(signal.aborted).toBe(true);
  });

  it("a second signal does not re-run the shutdown logic", () => {
    const onSignal = vi.fn();
    const signal = abortOnSignals(onSignal, [SIGNAL]);
    process.emit(SIGNAL);
    process.emit(SIGNAL);
    expect(signal.aborted).toBe(true);
    expect(onSignal).toHaveBeenCalledTimes(1);
  });
});
