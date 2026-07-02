import { describe, expect, it, vi } from "vitest";
import { Waker } from "../src/waker.js";

describe("Waker", () => {
  it("notify wakes a waiter", async () => {
    const waker = new Waker();
    const controller = new AbortController();
    const resolved = vi.fn();

    const waiting = waker.wait(controller.signal).then(resolved);
    expect(resolved).not.toHaveBeenCalled();

    waker.notify();
    await waiting;
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it("notify wakes all waiters at once", async () => {
    const waker = new Waker();
    const controller = new AbortController();

    const both = Promise.all([
      waker.wait(controller.signal),
      waker.wait(controller.signal),
    ]);
    waker.notify();

    await expect(both).resolves.toEqual([undefined, undefined]);
  });

  it("abort wakes a waiter", async () => {
    const waker = new Waker();
    const controller = new AbortController();

    const waiting = waker.wait(controller.signal);
    controller.abort();

    await expect(waiting).resolves.toBeUndefined();
  });

  it("wait on an already-aborted signal resolves right away", async () => {
    const waker = new Waker();
    const controller = new AbortController();
    controller.abort();

    await expect(waker.wait(controller.signal)).resolves.toBeUndefined();
  });

  it("notify without waiters is safe and does not wake a later wait", async () => {
    const waker = new Waker();
    const controller = new AbortController();
    waker.notify();

    const resolved = vi.fn();
    void waker.wait(controller.signal).then(resolved);
    await Promise.resolve();

    expect(resolved).not.toHaveBeenCalled();
    controller.abort();
  });

  it("after abort a waiter is removed from the list (notify does not wake it twice)", async () => {
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
