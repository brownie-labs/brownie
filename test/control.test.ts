import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentController, type AgentControlState } from "../src/control.js";

async function settled(promise: Promise<void>, ms = 20): Promise<boolean> {
  const marker = Symbol("pending");
  const result = await Promise.race([
    promise,
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(marker), ms)),
  ]);
  return result !== marker;
}

describe("AgentController", () => {
  let states: AgentControlState[];
  let controller: AgentController;
  let abort: AbortController;

  beforeEach(() => {
    states = [];
    controller = new AgentController((state) => states.push(state));
    abort = new AbortController();
  });

  it("starts running and the gate passes through immediately", async () => {
    expect(controller.state).toBe("running");
    expect(await settled(controller.gate(abort.signal))).toBe(true);
    expect(states).toEqual([]);
  });

  it("created as paused, blocks the gate until resume", async () => {
    const paused = new AgentController((state) => states.push(state), "paused");
    expect(paused.state).toBe("paused");
    expect(paused.pause()).toBe(false);

    const gate = paused.gate(abort.signal);
    expect(await settled(gate)).toBe(false);

    expect(paused.resume()).toBe(true);
    expect(await settled(gate)).toBe(true);
    expect(paused.state).toBe("running");
  });

  it("pause moves to pausing and the gate flips it to paused and blocks", async () => {
    expect(controller.pause()).toBe(true);
    expect(controller.state).toBe("pausing");

    const gate = controller.gate(abort.signal);
    expect(controller.state).toBe("paused");
    expect(await settled(gate)).toBe(false);

    expect(controller.resume()).toBe(true);
    expect(controller.state).toBe("running");
    expect(await settled(gate)).toBe(true);
    expect(states).toEqual(["pausing", "paused", "running"]);
  });

  it("pause is idempotent and resume without pause is a no-op", () => {
    expect(controller.pause()).toBe(true);
    expect(controller.pause()).toBe(false);
    expect(controller.resume()).toBe(true);
    expect(controller.resume()).toBe(false);
    expect(states).toEqual(["pausing", "running"]);
  });

  it("abort releases a blocked gate without changing the state", async () => {
    controller.pause();
    const gate = controller.gate(abort.signal);

    abort.abort();

    expect(await settled(gate)).toBe(true);
    expect(controller.state).toBe("paused");
  });

  it("gate on an already aborted signal passes through even when paused", async () => {
    controller.pause();
    abort.abort();

    expect(await settled(controller.gate(abort.signal))).toBe(true);
    expect(controller.state).toBe("pausing");
  });

  it("pauseRequested resolves on pause and immediately when not running", async () => {
    const waiting = controller.pauseRequested(abort.signal);
    expect(await settled(waiting)).toBe(false);

    controller.pause();
    expect(await settled(waiting)).toBe(true);
    expect(await settled(controller.pauseRequested(abort.signal))).toBe(true);
  });

  it("pauseRequested resolves on abort", async () => {
    const waiting = controller.pauseRequested(abort.signal);
    abort.abort();
    expect(await settled(waiting)).toBe(true);
  });

  describe("sleep", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sleeps for the full duration when nothing happens", async () => {
      let done = false;
      void controller.sleep(1_000, abort.signal).then(() => (done = true));

      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    });

    it("wakes early on a pause request", async () => {
      let done = false;
      void controller.sleep(60_000, abort.signal).then(() => (done = true));

      await vi.advanceTimersByTimeAsync(10);
      controller.pause();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    });

    it("wakes early on abort", async () => {
      let done = false;
      void controller.sleep(60_000, abort.signal).then(() => (done = true));

      await vi.advanceTimersByTimeAsync(10);
      abort.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    });

    it("returns immediately when already paused or aborted", async () => {
      controller.pause();
      let done = false;
      void controller.sleep(60_000, abort.signal).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);

      controller.resume();
      abort.abort();
      let doneAborted = false;
      void controller.sleep(60_000, abort.signal).then(() => (doneAborted = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(doneAborted).toBe(true);
    });

    it("repeated sleeps do not accumulate pause waiters", async () => {
      for (let i = 0; i < 5; i += 1) {
        const sleeping = controller.sleep(10, abort.signal);
        await vi.advanceTimersByTimeAsync(10);
        await sleeping;
      }

      controller.pause();
      const gate = controller.gate(abort.signal);
      controller.resume();
      await expect(gate).resolves.toBeUndefined();
    });
  });
});
