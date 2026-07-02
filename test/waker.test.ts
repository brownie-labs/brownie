import { describe, expect, it, vi } from "vitest";
import { Waker } from "../src/waker.js";

describe("Waker", () => {
  it("notify budzi oczekującego", async () => {
    const waker = new Waker();
    const controller = new AbortController();
    const resolved = vi.fn();

    const waiting = waker.wait(controller.signal).then(resolved);
    expect(resolved).not.toHaveBeenCalled();

    waker.notify();
    await waiting;
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it("notify budzi wszystkich oczekujących naraz", async () => {
    const waker = new Waker();
    const controller = new AbortController();

    const both = Promise.all([
      waker.wait(controller.signal),
      waker.wait(controller.signal),
    ]);
    waker.notify();

    await expect(both).resolves.toEqual([undefined, undefined]);
  });

  it("abort budzi oczekującego", async () => {
    const waker = new Waker();
    const controller = new AbortController();

    const waiting = waker.wait(controller.signal);
    controller.abort();

    await expect(waiting).resolves.toBeUndefined();
  });

  it("wait na przerwanym sygnale kończy się od razu", async () => {
    const waker = new Waker();
    const controller = new AbortController();
    controller.abort();

    await expect(waker.wait(controller.signal)).resolves.toBeUndefined();
  });

  it("notify bez oczekujących jest bezpieczne i nie budzi późniejszego wait", async () => {
    const waker = new Waker();
    const controller = new AbortController();
    waker.notify();

    const resolved = vi.fn();
    void waker.wait(controller.signal).then(resolved);
    await Promise.resolve();

    expect(resolved).not.toHaveBeenCalled();
    controller.abort();
  });

  it("po abort oczekujący nie zostaje na liście (notify nie budzi go podwójnie)", async () => {
    const waker = new Waker();
    const controller = new AbortController();

    const waiting = waker.wait(controller.signal);
    controller.abort();
    await waiting;

    waker.notify();
    const resolved = vi.fn();
    void waker.wait(new AbortController().signal).then(resolved);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
  });
});
