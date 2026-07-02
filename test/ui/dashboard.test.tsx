import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerStatusStore } from "../../src/status.js";
import type { Task } from "../../src/types.js";
import { Dashboard } from "../../src/ui/dashboard.js";
import { buildConfig } from "../helpers.js";

function createStore(): WorkerStatusStore {
  return new WorkerStatusStore({ notifyDelayMs: 0 });
}

async function flushed(store: WorkerStatusStore): Promise<void> {
  store.flush();
  await tick();
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    title: "Clean up repo",
    description: "Description",
    status: "pending",
    attempts: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Dashboard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the parameters of both agents in the header", () => {
    const store = createStore();
    const config = buildConfig({ cwd: "/tmp/ws" });
    const { lastFrame, unmount } = render(<Dashboard store={store} config={config} />);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("🧝 Brownie");
    expect(frame).toContain("monitor");
    expect(frame).toContain("model=haiku");
    expect(frame).toContain("interval=5 min");
    expect(frame).toContain("working hours=24/7");
    expect(frame).toContain("executor");
    expect(frame).toContain("model=opus");
    expect(frame).toContain("cwd=/tmp/ws");

    unmount();
    store.dispose();
  });

  it("shows the phases: monitor starting and executor waiting", () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("starting…");
    expect(frame).toContain("waiting for tasks");

    unmount();
    store.dispose();
  });

  it("after reporter events shows the cycle, session tail and outcome", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.monitor.cycleStarted(2);
    store.monitor.session({ type: "text", text: "Checking backlog" });
    store.monitor.session({ type: "toolUse", name: "Bash", input: "git log" });
    store.monitor.cycleFinished({
      cycle: 2,
      ok: true,
      durationMs: 1_200,
      addedTasks: 1,
      skippedDuplicates: 0,
    });
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("cycle #2");
    expect(frame).toContain("Checking backlog");
    expect(frame).toContain("🔧 Bash git log");
    expect(frame).toContain("new tasks: 1");

    unmount();
    store.dispose();
  });

  it("shows the task table with counters and the failed task error", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.setTasks([
      buildTask(),
      buildTask({ id: "t-2", title: "Deploy changes", status: "in_progress" }),
      buildTask({ id: "t-3", title: "Build report", status: "done" }),
      buildTask({
        id: "t-4",
        title: "Fix tests",
        status: "failed",
        error: "timeout",
      }),
    ]);
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("pending: 1");
    expect(frame).toContain("in progress: 1");
    expect(frame).toContain("done: 1");
    expect(frame).toContain("failed: 1");
    expect(frame).toContain("t-2 · Deploy changes");
    expect(frame).toContain("t-4 · Fix tests — timeout");

    unmount();
    store.dispose();
  });

  it("shows an empty table with a no-tasks message", () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    expect(lastFrame()).toContain("no tasks");

    unmount();
    store.dispose();
  });

  it("shows the shutdown message after a signal", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.shutdownRequested("SIGINT");
    await flushed(store);

    expect(lastFrame()).toContain("Received SIGINT — shutting down…");

    unmount();
    store.dispose();
  });

  it("counts down to the next cycle every second", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.monitor.sleepUntil(new Date(Date.now() + 90_000));
    store.flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(lastFrame()).toContain("next cycle in 01:30");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(lastFrame()).toContain("next cycle in 01:2");

    unmount();
    store.dispose();
  });

  it("shows the failed executor task outcome", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.executor.taskStarted(buildTask({ status: "in_progress" }));
    store.executor.taskFinished({
      taskId: "t-1",
      title: "Clean up repo",
      ok: false,
      durationMs: 300,
      error: "Session ended with an error (is_error)",
    });
    store.executor.waiting();
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("✖ t-1");
    expect(frame).toContain("Session ended with an");

    unmount();
    store.dispose();
  });

  it("shows cumulative stats in the header", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.monitor.cycleFinished({
      cycle: 1,
      ok: true,
      durationMs: 100,
      costUsd: 0.5,
      addedTasks: 0,
      skippedDuplicates: 0,
    });
    store.executor.taskFinished({
      taskId: "t-1",
      title: "Title",
      ok: true,
      durationMs: 100,
      costUsd: 0.25,
    });
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("stats");
    expect(frame).toContain("uptime");
    expect(frame).toContain("cycles 1");
    expect(frame).toContain("tasks ✔1 ✖0");
    expect(frame).toContain("cost $0.75");

    unmount();
    store.dispose();
  });

  it("warns when a session produces no output for a long time", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.monitor.cycleStarted(1);
    store.flush();
    await vi.advanceTimersByTimeAsync(180_000);

    expect(lastFrame()).toContain("⚠ no output");

    unmount();
    store.dispose();
  });

  it("shows the task age and attempt count", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.setTasks([
      buildTask({
        status: "in_progress",
        attempts: 2,
        updatedAt: new Date(Date.now() - 5 * 60_000 - 30_000).toISOString(),
      }),
    ]);
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("5m ago");
    expect(frame).toContain("attempts 2");

    unmount();
    store.dispose();
  });

  it("scrolls the focused panel tail and returns to follow mode on escape", async () => {
    const store = createStore();
    const { lastFrame, stdin, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    for (let i = 1; i <= 30; i += 1) {
      store.monitor.session({ type: "text", text: `line ${i}` });
    }
    await flushed(store);
    expect(lastFrame()).toContain("line 30");

    stdin.write("\u001B[A");
    await tick();
    let frame = lastFrame() ?? "";
    expect(frame).toContain("↓ 1 newer lines");
    expect(frame).not.toContain("line 30");

    stdin.write("\u001B");
    await tick();
    frame = lastFrame() ?? "";
    expect(frame).not.toContain("newer lines");
    expect(frame).toContain("line 30");

    unmount();
    store.dispose();
  });

  it("tab moves the scroll focus to the executor panel", async () => {
    const store = createStore();
    const { lastFrame, stdin, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    for (let i = 1; i <= 30; i += 1) {
      store.executor.session({ type: "text", text: `exec ${i}` });
    }
    await flushed(store);
    expect(lastFrame()).toContain("exec 30");

    stdin.write("\t");
    await tick();
    stdin.write("\u001B[A");
    await tick();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("↓ 1 newer lines");
    expect(frame).not.toContain("exec 30");

    unmount();
    store.dispose();
  });

  it("shows the keyboard hint line", () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    expect(lastFrame()).toContain("tab: switch panel");

    unmount();
    store.dispose();
  });

  it("ctrl+c triggers the SIGINT shutdown path", async () => {
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);
    const store = createStore();
    const { stdin, unmount } = render(<Dashboard store={store} config={buildConfig()} />);

    stdin.write("\u0003");
    await tick();
    expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGINT");

    unmount();
    store.dispose();
    killSpy.mockRestore();
  });

  it("shows backoff with a scheduled retry after a transient error", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.executor.taskFinished({
      taskId: "t-1",
      title: "Clean up repo",
      ok: false,
      durationMs: 300,
      error: "Session ended with an error (is_error)",
      willRetry: true,
      attempt: 1,
      maxAttempts: 3,
    });
    store.executor.retryScheduled(buildTask(), new Date(Date.now() + 30_000));
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("↻ retrying t-1 in");
    expect(frame).toContain("↻ t-1 · time=0.3s");

    unmount();
    store.dispose();
  });
});
