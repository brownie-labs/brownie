import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentController } from "../../src/control.js";
import type { TaskSummaryRecord } from "../../src/memory/store.js";
import { WorkerStatusStore } from "../../src/status.js";
import type { Task } from "../../src/types.js";
import { App, type AppProps } from "../../src/ui/app.js";
import { buildConfig } from "../helpers.js";

const PAGE_UP = "\u001B[5~";
const PAGE_DOWN = "\u001B[6~";
const ARROW_UP = "\u001B[A";
const ARROW_DOWN = "\u001B[B";
const ARROW_LEFT = "\u001B[D";
const ESCAPE = "\u001B";
const BACKSPACE = "\u007F";
const CTRL_C = "\u0003";
const ENTER = "\r";

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function flushed(store: WorkerStatusStore): Promise<void> {
  store.flush();
  await tick();
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

function buildRecord(overrides: Partial<TaskSummaryRecord> = {}): TaskSummaryRecord {
  return {
    id: 1,
    taskId: "t-1",
    attempt: 1,
    ok: true,
    title: "Clean up repo",
    headline: "Cleaned the repository",
    summary: "Removed stale branches.",
    error: undefined,
    sessionId: undefined,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

interface Harness {
  store: WorkerStatusStore;
  props: AppProps;
  monitorControl: AgentController;
  executorControl: AgentController;
  retry: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  addTasks: ReturnType<typeof vi.fn>;
  recent: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  requestExit: ReturnType<typeof vi.fn>;
}

function buildHarness(initialControlState: "running" | "paused" = "running"): Harness {
  const store = new WorkerStatusStore({ notifyDelayMs: 0 });
  const monitorControl = new AgentController((state) => {
    store.setControl("monitor", state);
  }, initialControlState);
  const executorControl = new AgentController((state) => {
    store.setControl("executor", state);
  }, initialControlState);
  store.setControl("monitor", initialControlState);
  store.setControl("executor", initialControlState);
  store.flush();
  const retry = vi.fn().mockResolvedValue(true);
  const cancel = vi.fn().mockResolvedValue(true);
  const addTasks = vi
    .fn()
    .mockImplementation((tasks: unknown[]) => Promise.resolve(tasks));
  const recent = vi.fn().mockReturnValue([buildRecord()]);
  const search = vi.fn().mockReturnValue([buildRecord({ id: 2, taskId: "t-2" })]);
  const notify = vi.fn();
  const requestExit = vi.fn();
  return {
    store,
    monitorControl,
    executorControl,
    retry,
    cancel,
    addTasks,
    recent,
    search,
    notify,
    requestExit,
    props: {
      store,
      config: buildConfig({ cwd: "/tmp/ws" }),
      version: "1.2.3",
      controls: { monitor: monitorControl, executor: executorControl },
      tasks: { retry, cancel, addTasks },
      memory: { recent, search },
      waker: { notify },
      requestExit,
    },
  };
}

async function type(
  stdin: { write: (data: string) => void },
  text: string,
): Promise<void> {
  stdin.write(text);
  await tick();
}

async function submit(
  stdin: { write: (data: string) => void },
  line: string,
): Promise<void> {
  await type(stdin, line);
  await type(stdin, ENTER);
}

describe("App", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the brand, version, cwd and agent parameters in the header", () => {
    const { store, props } = buildHarness();
    const { lastFrame, unmount } = render(<App {...props} />);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("🧌 Brownie v1.2.3");
    expect(frame).toContain("/tmp/ws");
    expect(frame).toContain("monitor");
    expect(frame).toContain("haiku · medium · every 5 min");
    expect(frame).toContain("executor");
    expect(frame).toContain("opus · high");

    unmount();
    store.dispose();
  });

  it("shows the header stats line with task counts", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, unmount } = render(<App {...props} />);

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
    store.setTasks([buildTask(), buildTask({ id: "t-2", status: "done" })]);
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("↑");
    expect(frame).toContain("$0.75");
    expect(frame).toContain("1 cycles");
    expect(frame).toContain("tasks 1 pending / 0 running / 1 done / 0 failed");

    unmount();
    store.dispose();
  });

  it("shows the phases: monitor starting and executor waiting", () => {
    const { store, props } = buildHarness();
    const { lastFrame, unmount } = render(<App {...props} />);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("starting…");
    expect(frame).toContain("waiting for tasks");

    unmount();
    store.dispose();
  });

  it("after reporter events shows the cycle, session tail and outcome", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, unmount } = render(<App {...props} />);

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
    const { store, props } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    store.setTasks([
      buildTask(),
      buildTask({ id: "t-2", title: "Deploy changes", status: "in_progress" }),
      buildTask({ id: "t-3", title: "Build report", status: "done" }),
      buildTask({ id: "t-4", title: "Fix tests", status: "failed", error: "timeout" }),
      buildTask({ id: "t-5", title: "Old idea", status: "cancelled" }),
    ]);
    await flushed(store);
    await submit(stdin, "/tasks");

    const frame = lastFrame() ?? "";
    expect(frame).toContain("pending: 1");
    expect(frame).toContain("in progress: 1");
    expect(frame).toContain("done: 1");
    expect(frame).toContain("failed: 1");
    expect(frame).toContain("t-2 · Deploy changes");
    expect(frame).toContain("t-4 · Fix tests — timeout");
    expect(frame).toContain("t-5 · Old idea");
    expect(frame).toContain("cancelled");

    unmount();
    store.dispose();
  });

  it("shows the shutdown message after a signal", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, unmount } = render(<App {...props} />);

    store.shutdownRequested("SIGINT");
    await flushed(store);

    expect(lastFrame()).toContain("Received SIGINT — shutting down…");

    unmount();
    store.dispose();
  });

  it("counts down to the next cycle every second", async () => {
    vi.useFakeTimers();
    const { store, props } = buildHarness();
    const { lastFrame, unmount } = render(<App {...props} />);

    store.monitor.sleepUntil(new Date(Date.now() + 90_000));
    store.flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(lastFrame()).toContain("next cycle in 01:30");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(lastFrame()).toContain("next cycle in 01:2");

    unmount();
    store.dispose();
  });

  it("warns when a session produces no output for a long time", async () => {
    vi.useFakeTimers();
    const { store, props } = buildHarness();
    const { lastFrame, unmount } = render(<App {...props} />);

    store.monitor.cycleStarted(1);
    store.flush();
    await vi.advanceTimersByTimeAsync(180_000);

    expect(lastFrame()).toContain("⚠ no output");

    unmount();
    store.dispose();
  });

  it("shows backoff with a scheduled retry after a transient error", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, unmount } = render(<App {...props} />);

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

  it("scrolls the focused panel with page-up and returns to follow mode on escape", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    for (let i = 1; i <= 60; i += 1) {
      store.monitor.session({ type: "text", text: `line ${i}` });
    }
    await flushed(store);
    expect(lastFrame()).toContain("line 60");

    await type(stdin, PAGE_UP);
    let frame = lastFrame() ?? "";
    expect(frame).toContain("newer lines");
    expect(frame).not.toContain("line 60");

    await type(stdin, ESCAPE);
    frame = lastFrame() ?? "";
    expect(frame).not.toContain("newer lines");
    expect(frame).toContain("line 60");

    unmount();
    store.dispose();
  });

  it("tab with an empty input moves the scroll focus to the executor panel", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    for (let i = 1; i <= 60; i += 1) {
      store.executor.session({ type: "text", text: `exec ${i}` });
    }
    await flushed(store);
    expect(lastFrame()).toContain("exec 60");

    await type(stdin, "\t");
    await type(stdin, PAGE_UP);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("newer lines");
    expect(frame).not.toContain("exec 60");

    await type(stdin, PAGE_DOWN);
    expect(lastFrame()).toContain("exec 60");

    unmount();
    store.dispose();
  });

  it("ctrl+c triggers the SIGINT shutdown path", async () => {
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);
    const { store, props } = buildHarness();
    const { stdin, unmount } = render(<App {...props} />);

    await type(stdin, CTRL_C);
    expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGINT");

    unmount();
    store.dispose();
    killSpy.mockRestore();
  });

  it("edits the command line: typing, ghost suggestion, backspace, cursor moves", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    await type(stdin, "/mo");
    let frame = lastFrame() ?? "";
    expect(frame).toContain("/mo");
    expect(frame).toContain("nitor");

    await type(stdin, BACKSPACE);
    frame = lastFrame() ?? "";
    expect(frame).toContain("/m");
    expect(frame).not.toContain("/mo");

    await type(stdin, ARROW_LEFT);
    await type(stdin, "x");
    expect(lastFrame()).toContain("/xm");

    await type(stdin, ESCAPE);
    expect(lastFrame()).not.toContain("/xm");

    unmount();
    store.dispose();
  });

  it("tab completes a command prefix", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    await type(stdin, "/da");
    await type(stdin, "\t");
    expect(lastFrame()).toContain("/dashboard");

    unmount();
    store.dispose();
  });

  it("switches views with slash commands and shows the view name in the hint line", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    expect(lastFrame()).toContain("dashboard · /help");

    await submit(stdin, "/tasks");
    let frame = lastFrame() ?? "";
    expect(frame).toContain("tasks · /help");
    expect(frame).toContain("Tasks");
    expect(frame).not.toContain("Executor");

    await submit(stdin, "/monitor");
    frame = lastFrame() ?? "";
    expect(frame).toContain("Recent outcomes");
    expect(frame).toContain("nothing finished yet");

    await submit(stdin, "/help");
    frame = lastFrame() ?? "";
    expect(frame).toContain("Commands");
    expect(frame).toContain("/pause [monitor|executor]");

    await submit(stdin, "/dashboard");
    expect(lastFrame()).toContain("Executor");

    unmount();
    store.dispose();
  });

  it("recalls history with the arrow keys", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    await submit(stdin, "/tasks");
    await submit(stdin, "/help");
    expect(lastFrame()).not.toContain("> /help");

    await type(stdin, ARROW_UP);
    expect(lastFrame()).toContain("> /help");
    await type(stdin, ARROW_UP);
    expect(lastFrame()).toContain("> /tasks");
    await type(stdin, ARROW_DOWN);
    expect(lastFrame()).toContain("> /help");

    unmount();
    store.dispose();
  });

  it("/memory shows recent entries and /memory <query> searches", async () => {
    const { store, props, recent, search } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    await submit(stdin, "/memory");
    let frame = lastFrame() ?? "";
    expect(recent).toHaveBeenCalledWith(20);
    expect(frame).toContain("Memory · recent entries");
    expect(frame).toContain("t-1 · Cleaned the repository");

    await submit(stdin, "/memory deploy");
    frame = lastFrame() ?? "";
    expect(search).toHaveBeenCalledWith("deploy", 20);
    expect(frame).toContain('Memory · search "deploy" · 1 results');

    unmount();
    store.dispose();
  });

  it("/pause shows a notice and the pausing state in the header", async () => {
    const { store, props, monitorControl, executorControl } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    await submit(stdin, "/pause");
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(monitorControl.state).toBe("pausing");
    expect(executorControl.state).toBe("pausing");
    expect(frame).toContain("pausing monitor and executor");
    expect(frame).toContain("⏸ pausing…");

    await submit(stdin, "/start monitor");
    await flushed(store);
    expect(monitorControl.state).toBe("running");
    expect(lastFrame()).toContain("started monitor");

    unmount();
    store.dispose();
  });

  it("boots paused: shows the hint notice and /start wakes both agents", async () => {
    const { store, props, monitorControl, executorControl } = buildHarness("paused");
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    let frame = lastFrame() ?? "";
    expect(frame).toContain("agents are paused — run /start to wake them");
    expect(frame).toContain("⏸ paused");

    await submit(stdin, "/start");
    await flushed(store);

    frame = lastFrame() ?? "";
    expect(monitorControl.state).toBe("running");
    expect(executorControl.state).toBe("running");
    expect(frame).toContain("started monitor and executor");
    expect(frame).not.toContain("⏸ paused");

    unmount();
    store.dispose();
  });

  it("/task adds a manual task and wakes the executor", async () => {
    const { store, props, addTasks, notify } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    await submit(stdin, "/task Fix the deploy pipeline");

    const candidates = addTasks.mock.calls[0]?.[0] as { title: string }[] | undefined;
    expect(candidates?.[0]?.title).toBe("Fix the deploy pipeline");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toContain("added");

    unmount();
    store.dispose();
  });

  it("unknown commands produce an error notice and plain text is ignored", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} />);

    await submit(stdin, "/nope");
    expect(lastFrame()).toContain("unknown command /nope — try /help");

    await submit(stdin, "hello");
    expect(lastFrame()).toContain("> hello");

    unmount();
    store.dispose();
  });

  it("the notice disappears after the configured timeout", async () => {
    const { store, props } = buildHarness();
    const { lastFrame, stdin, unmount } = render(<App {...props} noticeTimeoutMs={40} />);

    await submit(stdin, "/nope");
    expect(lastFrame()).toContain("unknown command");

    await tick();
    await tick();
    expect(lastFrame()).not.toContain("unknown command");

    unmount();
    store.dispose();
  });

  it("/exit requests a graceful shutdown", async () => {
    const { store, props, requestExit } = buildHarness();
    const { stdin, unmount } = render(<App {...props} />);

    await submit(stdin, "/exit");
    expect(requestExit).toHaveBeenCalledTimes(1);

    unmount();
    store.dispose();
  });
});
