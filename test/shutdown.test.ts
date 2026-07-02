import { afterEach, describe, expect, it, vi } from "vitest";
import { abortOnSignals } from "../src/shutdown.js";

const SIGNAL: NodeJS.Signals = "SIGUSR2";

describe("abortOnSignals", () => {
  afterEach(() => {
    process.removeAllListeners(SIGNAL);
  });

  it("nie jest przerwany zanim nadejdzie sygnał", () => {
    const signal = abortOnSignals(undefined, [SIGNAL]);
    expect(signal.aborted).toBe(false);
  });

  it("po sygnale ustawia abort i woła callback z nazwą sygnału", () => {
    const onSignal = vi.fn();
    const signal = abortOnSignals(onSignal, [SIGNAL]);
    process.emit(SIGNAL);
    expect(signal.aborted).toBe(true);
    expect(onSignal).toHaveBeenCalledWith(SIGNAL);
  });

  it("działa bez callbacka", () => {
    const signal = abortOnSignals(undefined, [SIGNAL]);
    process.emit(SIGNAL);
    expect(signal.aborted).toBe(true);
  });

  it("drugi sygnał nie wywołuje ponownie logiki zamykania", () => {
    const onSignal = vi.fn();
    const signal = abortOnSignals(onSignal, [SIGNAL]);
    process.emit(SIGNAL);
    process.emit(SIGNAL);
    expect(signal.aborted).toBe(true);
    expect(onSignal).toHaveBeenCalledTimes(1);
  });
});
