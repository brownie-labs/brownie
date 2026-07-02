import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDuration, sleep } from "../src/timing.js";

describe("sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the time elapses", async () => {
    const resolved = vi.fn();
    void sleep(1000, new AbortController().signal).then(resolved);

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it("abort interrupts the sleep immediately", async () => {
    const controller = new AbortController();
    const resolved = vi.fn();
    void sleep(60_000, controller.signal).then(resolved);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it("on an already-aborted signal resolves right away", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(60_000, controller.signal)).resolves.toBeUndefined();
  });
});

describe("formatDuration", () => {
  it("formats milliseconds as seconds with one decimal place", () => {
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(0)).toBe("0.0s");
    expect(formatDuration(61_230)).toBe("61.2s");
  });
});
