import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSessionEvent } from "../src/session-events.js";
import { WorkerStatusStore } from "../src/status.js";
import type { Task } from "../src/types.js";

function createStore(
  options: ConstructorParameters<typeof WorkerStatusStore>[0] = {},
): WorkerStatusStore {
  return new WorkerStatusStore({ notifyDelayMs: 0, ...options });
}

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    title: "Title",
    description: "Description",
    status: "pending",
    attempts: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkerStatusStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("initial state: monitor starting, executor waiting, no tasks", () => {
    const store = createStore();
    const status = store.getSnapshot();
    expect(status.monitor.phase).toEqual({ kind: "starting" });
    expect(status.executor.phase).toEqual({ kind: "waiting" });
    expect(status.monitor.tail).toEqual([]);
    expect(status.tasks).toEqual([]);
    expect(status.shutdownSignal).toBeUndefined();
    store.dispose();
  });

  it("transitions through monitor phases", () => {
    const store = createStore();
    const resumeAt = new Date("2026-07-02T08:00:00");
    store.monitor.offHours(resumeAt);
    store.flush();
    expect(store.getSnapshot().monitor.phase).toEqual({
      kind: "offHours",
      resumeAt: resumeAt.getTime(),
    });

    store.monitor.cycleStarted(3);
    store.flush();
    const session = store.getSnapshot().monitor.phase;
    expect(session.kind).toBe("session");
    if (session.kind === "session") expect(session.cycle).toBe(3);

    const nextCycleAt = new Date(Date.now() + 60_000);
    store.monitor.sleepUntil(nextCycleAt);
    store.flush();
    expect(store.getSnapshot().monitor.phase).toEqual({
      kind: "sleeping",
      nextCycleAt: nextCycleAt.getTime(),
    });
    store.dispose();
  });

  it("transitions through executor phases and records the task outcome", () => {
    const store = createStore();
    const task = buildTask();
    store.executor.taskStarted(task);
    store.flush();
    const phase = store.getSnapshot().executor.phase;
    expect(phase.kind).toBe("session");
    if (phase.kind === "session") expect(phase.task.id).toBe("t-1");

    store.executor.taskFinished({
      taskId: "t-1",
      title: "Title",
      ok: true,
      durationMs: 1200,
      costUsd: 0.02,
      numTurns: 3,
      error: undefined,
    });
    store.executor.waiting();
    store.flush();
    const status = store.getSnapshot();
    expect(status.executor.phase).toEqual({ kind: "waiting" });
    expect(status.executor.lastOutcome).toMatchObject({
      taskId: "t-1",
      ok: true,
      durationMs: 1200,
    });
    store.dispose();
  });

  it("summaryStarted sets the summary phase without clearing the tail", () => {
    const store = createStore();
    const task = buildTask();
    store.executor.taskStarted(task);
    store.executor.session({ type: "text", text: "working on task" });
    store.executor.summaryStarted(task);
    store.flush();

    const status = store.getSnapshot().executor;
    expect(status.phase.kind).toBe("summary");
    if (status.phase.kind === "summary") expect(status.phase.task.id).toBe("t-1");
    expect(status.tail).toContain("working on task");
    store.dispose();
  });

  it("summaryFinished appends a line to the tail and does not overwrite the task outcome", () => {
    const store = createStore();
    store.executor.taskFinished({
      taskId: "t-1",
      title: "Title",
      ok: true,
      durationMs: 1200,
      costUsd: undefined,
      numTurns: undefined,
      error: undefined,
    });
    store.executor.summaryFinished({
      taskId: "t-1",
      ok: true,
      durationMs: 700,
      costUsd: 0.0123,
      error: undefined,
    });
    store.executor.summaryFinished({
      taskId: "t-1",
      ok: false,
      durationMs: 300,
      costUsd: undefined,
      error: "invalid summary report",
    });
    store.flush();

    const status = store.getSnapshot().executor;
    expect(status.lastOutcome?.taskId).toBe("t-1");
    expect(status.tail.some((l) => l.includes("✔ memory: summary t-1"))).toBe(true);
    expect(
      status.tail.some(
        (l) =>
          l.includes("✖ memory: summary t-1") && l.includes("invalid summary report"),
      ),
    ).toBe(true);
    store.dispose();
  });

  it("records the monitor cycle outcome with a finish time", () => {
    const store = createStore();
    store.monitor.cycleFinished({
      cycle: 1,
      ok: false,
      durationMs: 500,
      costUsd: undefined,
      addedTasks: 0,
      skippedDuplicates: 0,
      error: "invalid task report",
    });
    store.flush();
    const outcome = store.getSnapshot().monitor.lastOutcome;
    expect(outcome).toMatchObject({
      cycle: 1,
      ok: false,
      error: "invalid task report",
    });
    expect(outcome?.finishedAt).toBeGreaterThan(0);
    store.dispose();
  });

  it("session events land in the tail, init sets the sessionId", () => {
    const store = createStore();
    store.monitor.session({
      type: "init",
      model: "haiku",
      sessionId: "sess-7",
      toolCount: 2,
    });
    store.monitor.session({ type: "text", text: "Checking repo" });
    store.monitor.session({ type: "toolUse", name: "Bash", input: "git status" });
    store.flush();
    const panel = store.getSnapshot().monitor;
    expect(panel.sessionId).toBe("sess-7");
    expect(panel.tail).toEqual([
      "init · model=haiku · session=sess-7 · tools: 2",
      "Checking repo",
      "🔧 Bash git status",
    ]);
    store.dispose();
  });

  it("joins partial deltas and shows the open line as the last tail element", () => {
    const store = createStore();
    store.monitor.session({ type: "partial", text: "abc" });
    store.monitor.session({ type: "partial", text: "def\ngh" });
    store.flush();
    expect(store.getSnapshot().monitor.tail).toEqual(["abcdef", "gh"]);

    store.monitor.session({ type: "partial", text: "i\n" });
    store.flush();
    expect(store.getSnapshot().monitor.tail).toEqual(["abcdef", "ghi"]);
    store.dispose();
  });

  it("skips a text event duplicated by earlier partials", () => {
    const store = createStore();
    store.monitor.session({ type: "partial", text: "Report ready" });
    store.monitor.session({ type: "text", text: "Report ready" });
    store.flush();
    expect(store.getSnapshot().monitor.tail).toEqual(["Report ready"]);
    store.dispose();
  });

  it("an event other than text restores appending of subsequent texts", () => {
    const store = createStore();
    store.monitor.session({ type: "partial", text: "first" });
    store.monitor.session({ type: "text", text: "first" });
    store.monitor.session({ type: "toolUse", name: "Bash", input: "ls" });
    store.monitor.session({ type: "text", text: "second" });
    store.flush();
    expect(store.getSnapshot().monitor.tail).toEqual(["first", "🔧 Bash ls", "second"]);
    store.dispose();
  });

  it("retryScheduled sets the backoff phase with a resume time", () => {
    const store = createStore();
    const resumeAt = new Date(Date.now() + 30_000);
    store.executor.retryScheduled(buildTask(), resumeAt);
    store.flush();
    expect(store.getSnapshot().executor.phase).toEqual({
      kind: "backoff",
      task: expect.objectContaining({ id: "t-1" }) as Task,
      resumeAt: resumeAt.getTime(),
    });
    store.dispose();
  });

  it("a new session clears the tail and sessionId", () => {
    const store = createStore();
    store.monitor.session({
      type: "init",
      model: "haiku",
      sessionId: "sess-1",
      toolCount: 0,
    });
    store.monitor.session({ type: "partial", text: "in progress" });
    store.monitor.cycleStarted(2);
    store.flush();
    const panel = store.getSnapshot().monitor;
    expect(panel.tail).toEqual([]);
    expect(panel.sessionId).toBeUndefined();
    store.dispose();
  });

  it("limits the tail to the given limit", () => {
    const store = createStore({ tailLimit: 3 });
    for (let i = 1; i <= 5; i += 1) {
      store.executor.session({ type: "text", text: `line ${i}` });
    }
    store.flush();
    expect(store.getSnapshot().executor.tail).toEqual(["line 3", "line 4", "line 5"]);
    store.dispose();
  });

  it("truncates very long tail lines", () => {
    const store = createStore();
    store.monitor.session({ type: "text", text: "x".repeat(500) });
    store.flush();
    const [line] = store.getSnapshot().monitor.tail;
    expect(line?.length).toBeLessThanOrEqual(301);
    expect(line?.endsWith("…")).toBe(true);
    store.dispose();
  });

  it("returns a stable snapshot between notifications", () => {
    const store = createStore();
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    store.monitor.cycleStarted(1);
    expect(store.getSnapshot()).toBe(first);
    store.flush();
    expect(store.getSnapshot()).not.toBe(first);
    store.dispose();
  });

  it("coalesces a burst of changes into a single notification", () => {
    vi.useFakeTimers();
    const store = new WorkerStatusStore({ notifyDelayMs: 50 });
    const listener = vi.fn();
    store.subscribe(listener);
    for (let i = 0; i < 20; i += 1) {
      store.monitor.session({ type: "partial", text: `${i}` });
    }
    vi.advanceTimersByTime(49);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("unsubscribe stops notifications", () => {
    const store = createStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.monitor.cycleStarted(1);
    store.flush();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.monitor.cycleStarted(2);
    store.flush();
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("setTasks copies tasks — a later mutation of the input does not change the snapshot", () => {
    const store = createStore();
    const task = buildTask();
    store.setTasks([task]);
    store.flush();
    task.status = "failed";
    expect(store.getSnapshot().tasks[0]?.status).toBe("pending");
    store.dispose();
  });

  it("accumulates stats: cycles, task counters and the total cost", () => {
    const store = createStore();
    store.monitor.cycleFinished({
      cycle: 1,
      ok: true,
      durationMs: 100,
      costUsd: 0.5,
      addedTasks: 1,
      skippedDuplicates: 0,
    });
    store.executor.taskFinished({
      taskId: "t-1",
      title: "Title",
      ok: true,
      durationMs: 100,
      costUsd: 0.25,
    });
    store.executor.taskFinished({
      taskId: "t-2",
      title: "Title",
      ok: false,
      durationMs: 100,
      costUsd: 0.125,
      willRetry: true,
    });
    store.executor.taskFinished({
      taskId: "t-2",
      title: "Title",
      ok: false,
      durationMs: 100,
      costUsd: 0.0625,
    });
    store.executor.summaryFinished({
      taskId: "t-1",
      ok: true,
      durationMs: 50,
      costUsd: 0.0625,
      error: undefined,
    });
    store.flush();
    expect(store.getSnapshot().stats).toEqual({
      cycles: 1,
      tasksSucceeded: 1,
      tasksFailed: 1,
      totalCostUsd: 1,
    });
    store.dispose();
  });

  it("treats a missing cost as zero in the stats", () => {
    const store = createStore();
    store.monitor.cycleFinished({
      cycle: 1,
      ok: false,
      durationMs: 100,
      addedTasks: 0,
      skippedDuplicates: 0,
      error: "boom",
    });
    store.flush();
    expect(store.getSnapshot().stats).toEqual({
      cycles: 1,
      tasksSucceeded: 0,
      tasksFailed: 0,
      totalCostUsd: 0,
    });
    store.dispose();
  });

  it("records the time of the last session event and clears it on a new session", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const store = createStore();
    expect(store.getSnapshot().monitor.lastEventAt).toBeUndefined();

    store.monitor.session({ type: "text", text: "hello" });
    store.flush();
    expect(store.getSnapshot().monitor.lastEventAt).toBe(1_000);

    vi.setSystemTime(5_000);
    store.monitor.session({ type: "toolUse", name: "Bash", input: "ls" });
    store.flush();
    expect(store.getSnapshot().monitor.lastEventAt).toBe(5_000);

    store.monitor.cycleStarted(2);
    store.flush();
    expect(store.getSnapshot().monitor.lastEventAt).toBeUndefined();
    store.dispose();
  });

  it("shutdownRequested records the signal name", () => {
    const store = createStore();
    store.shutdownRequested("SIGINT");
    store.flush();
    expect(store.getSnapshot().shutdownSignal).toBe("SIGINT");
    store.dispose();
  });

  it("dispose cancels the scheduled notification", () => {
    vi.useFakeTimers();
    const store = new WorkerStatusStore({ notifyDelayMs: 50 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.monitor.cycleStarted(1);
    store.dispose();
    vi.advanceTimersByTime(100);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("formatSessionEvent", () => {
  it("formats all event types", () => {
    expect(
      formatSessionEvent({ type: "init", model: "haiku", sessionId: "s", toolCount: 1 }),
    ).toBe("init · model=haiku · session=s · tools: 1");
    expect(formatSessionEvent({ type: "text", text: "abc" })).toBe("abc");
    expect(formatSessionEvent({ type: "toolUse", name: "Bash", input: "ls" })).toBe(
      "🔧 Bash ls",
    );
    expect(
      formatSessionEvent({ type: "toolResult", isError: false, content: "ok" }),
    ).toBe("↳ result ok");
    expect(
      formatSessionEvent({ type: "toolResult", isError: true, content: "boom" }),
    ).toBe("⚠ result(error) boom");
    expect(formatSessionEvent({ type: "raw", line: "x" })).toBe("(non-JSON) x");
    expect(formatSessionEvent({ type: "stderr", line: "err" })).toBe("stderr: err");
    expect(formatSessionEvent({ type: "killing", reason: "timeout" })).toBe(
      "⏹ Stopping session (timeout)…",
    );
    expect(formatSessionEvent({ type: "procError", message: "pad" })).toBe("✖ pad");
  });
});
