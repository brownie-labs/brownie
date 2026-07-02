import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/logger.js";
import { abortOnSignals } from "../src/shutdown.js";

const SIGNAL: NodeJS.Signals = "SIGUSR2";

describe("abortOnSignals", () => {
  beforeEach(() => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.removeAllListeners(SIGNAL);
    vi.restoreAllMocks();
  });

  it("nie jest przerwany zanim nadejdzie sygnał", () => {
    const signal = abortOnSignals([SIGNAL]);
    expect(signal.aborted).toBe(false);
  });

  it("po sygnale ustawia abort i loguje ostrzeżenie", () => {
    const signal = abortOnSignals([SIGNAL]);
    process.emit(SIGNAL);
    expect(signal.aborted).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(SIGNAL));
  });

  it("drugi sygnał nie wywołuje ponownie logiki zamykania", () => {
    const signal = abortOnSignals([SIGNAL]);
    process.emit(SIGNAL);
    process.emit(SIGNAL);
    expect(signal.aborted).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
