import { describe, expect, it, vi } from "vitest";
import { AgentController } from "../../src/control.js";
import type { TaskSummaryRecord } from "../../src/memory/store.js";
import {
  buildManualTask,
  COMMANDS,
  dispatchCommand,
  parseCommand,
  suggest,
  type CommandContext,
  type View,
} from "../../src/ui/commands.js";

function buildRecord(id: number): TaskSummaryRecord {
  return {
    id,
    taskId: `t-${id}`,
    attempt: 1,
    ok: true,
    title: `Title ${id}`,
    headline: `Headline ${id}`,
    summary: `Summary ${id}`,
    error: undefined,
    sessionId: undefined,
    createdAt: "2026-07-01T10:00:00.000Z",
  };
}

interface FakeContext {
  ctx: CommandContext;
  views: View[];
  notices: { text: string; tone: string }[];
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

function fakeContext(): FakeContext {
  const views: View[] = [];
  const notices: { text: string; tone: string }[] = [];
  const monitorControl = new AgentController(() => undefined);
  const executorControl = new AgentController(() => undefined);
  const retry = vi.fn().mockResolvedValue(true);
  const cancel = vi.fn().mockResolvedValue(true);
  const addTasks = vi
    .fn()
    .mockImplementation((tasks: unknown[]) => Promise.resolve(tasks));
  const recent = vi.fn().mockReturnValue([buildRecord(2), buildRecord(1)]);
  const search = vi.fn().mockReturnValue([buildRecord(3)]);
  const notify = vi.fn();
  const requestExit = vi.fn();
  return {
    views,
    notices,
    monitorControl,
    executorControl,
    retry,
    cancel,
    addTasks,
    recent,
    search,
    notify,
    requestExit,
    ctx: {
      setView: (view) => views.push(view),
      monitorControl,
      executorControl,
      tasks: { retry, cancel, addTasks },
      memory: { recent, search },
      waker: { notify },
      requestExit,
      notice: (text, tone = "info") => notices.push({ text, tone }),
    },
  };
}

describe("parseCommand", () => {
  it("splits the name and arguments, lowercases the name", () => {
    expect(parseCommand("/PAUSE  monitor ")).toEqual({
      name: "pause",
      args: "monitor",
    });
    expect(parseCommand("/help")).toEqual({ name: "help", args: "" });
  });

  it("rejects non-command lines", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("/")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });
});

describe("suggest", () => {
  it("completes a unique prefix to a command", () => {
    expect(suggest("/mo")).toBe("/monitor");
    expect(suggest("/da")).toBe("/dashboard");
  });

  it("returns nothing for exact names, unknown prefixes and lines with arguments", () => {
    expect(suggest("/task")).toBeUndefined();
    expect(suggest("/zzz")).toBeUndefined();
    expect(suggest("/pause mon")).toBeUndefined();
    expect(suggest("plain text")).toBeUndefined();
  });
});

describe("dispatchCommand", () => {
  it("switches views for the view commands", async () => {
    const { ctx, views } = fakeContext();
    for (const line of ["/dashboard", "/monitor", "/executor", "/tasks", "/help"]) {
      await dispatchCommand(line, ctx);
    }
    expect(views.map((view) => view.kind)).toEqual([
      "dashboard",
      "monitor",
      "executor",
      "tasks",
      "help",
    ]);
  });

  it("reports unknown commands as an error notice", async () => {
    const { ctx, notices } = fakeContext();
    await dispatchCommand("/nope", ctx);
    expect(notices).toEqual([
      { text: "unknown command /nope — try /help", tone: "error" },
    ]);
  });

  it("/memory without a query shows recent entries", async () => {
    const { ctx, views, recent } = fakeContext();
    await dispatchCommand("/memory", ctx);
    expect(recent).toHaveBeenCalledWith(20);
    expect(views[0]).toMatchObject({ kind: "memory", query: undefined });
    if (views[0]?.kind === "memory") expect(views[0].entries).toHaveLength(2);
  });

  it("/memory with a query searches the store", async () => {
    const { ctx, views, search } = fakeContext();
    await dispatchCommand("/memory deploy errors", ctx);
    expect(search).toHaveBeenCalledWith("deploy errors", 20);
    expect(views[0]).toMatchObject({ kind: "memory", query: "deploy errors" });
  });

  it("/pause without arguments pauses both agents", async () => {
    const { ctx, notices, monitorControl, executorControl } = fakeContext();
    await dispatchCommand("/pause", ctx);
    expect(monitorControl.state).toBe("pausing");
    expect(executorControl.state).toBe("pausing");
    expect(notices[0]?.text).toBe("pausing monitor and executor");
  });

  it("/pause of an already paused agent reports it", async () => {
    const { ctx, notices, monitorControl } = fakeContext();
    monitorControl.pause();
    await dispatchCommand("/pause", ctx);
    expect(notices[0]?.text).toBe("pausing executor · monitor already paused");
  });

  it("/pause validates the agent name", async () => {
    const { ctx, notices, monitorControl } = fakeContext();
    await dispatchCommand("/pause everything", ctx);
    expect(monitorControl.state).toBe("running");
    expect(notices[0]).toEqual({
      text: 'unknown agent "everything" — use monitor or executor',
      tone: "error",
    });
  });

  it("/start starts a single agent and reports running ones", async () => {
    const { ctx, notices, monitorControl, executorControl } = fakeContext();
    monitorControl.pause();
    await dispatchCommand("/start monitor", ctx);
    expect(monitorControl.state).toBe("running");
    expect(notices[0]?.text).toBe("started monitor");

    await dispatchCommand("/start executor", ctx);
    expect(executorControl.state).toBe("running");
    expect(notices[1]?.text).toBe("executor already running");
  });

  it("/start without arguments starts both paused agents", async () => {
    const { ctx, notices, monitorControl, executorControl } = fakeContext();
    monitorControl.pause();
    executorControl.pause();
    await dispatchCommand("/start", ctx);
    expect(monitorControl.state).toBe("running");
    expect(executorControl.state).toBe("running");
    expect(notices[0]?.text).toBe("started monitor and executor");
  });

  it("/retry requeues a failed task and wakes the executor", async () => {
    const { ctx, notices, retry, notify } = fakeContext();
    await dispatchCommand("/retry t-1", ctx);
    expect(retry).toHaveBeenCalledWith("t-1");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notices[0]?.text).toBe("task t-1 requeued");
  });

  it("/retry reports a missing task and requires an id", async () => {
    const { ctx, notices, retry, notify } = fakeContext();
    retry.mockResolvedValue(false);
    await dispatchCommand("/retry ghost", ctx);
    await dispatchCommand("/retry", ctx);
    expect(notify).not.toHaveBeenCalled();
    expect(notices).toEqual([
      { text: 'no failed task "ghost"', tone: "error" },
      { text: "usage: /retry <task-id>", tone: "error" },
    ]);
  });

  it("/cancel cancels a pending task and reports non-cancellable ones", async () => {
    const { ctx, notices, cancel } = fakeContext();
    await dispatchCommand("/cancel t-1", ctx);
    cancel.mockResolvedValue(false);
    await dispatchCommand("/cancel t-2", ctx);
    expect(notices).toEqual([
      { text: "task t-1 cancelled", tone: "info" },
      {
        text: 'no pending task "t-2" — only pending tasks can be cancelled',
        tone: "error",
      },
    ]);
  });

  it("/task adds a manual task and wakes the executor", async () => {
    const { ctx, notices, addTasks, notify } = fakeContext();
    await dispatchCommand("/task Check the failing deploy pipeline", ctx);
    const candidate = addTasks.mock.calls[0]?.[0] as
      { id: string; title: string; description: string }[] | undefined;
    expect(candidate?.[0]?.id).toMatch(/^manual-/);
    expect(candidate?.[0]?.title).toBe("Check the failing deploy pipeline");
    expect(candidate?.[0]?.description).toBe("Check the failing deploy pipeline");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notices[0]?.text).toMatch(/^task manual-.* added$/);
  });

  it("/task requires a description and reports duplicates", async () => {
    const { ctx, notices, addTasks, notify } = fakeContext();
    await dispatchCommand("/task", ctx);
    addTasks.mockResolvedValue([]);
    await dispatchCommand("/task something", ctx);
    expect(notify).not.toHaveBeenCalled();
    expect(notices[0]).toEqual({ text: "usage: /task <description>", tone: "error" });
    expect(notices[1]?.text).toMatch(/already exists$/);
    expect(notices[1]?.tone).toBe("error");
  });

  it("/exit requests a graceful shutdown", async () => {
    const { ctx, requestExit } = fakeContext();
    await dispatchCommand("/exit", ctx);
    expect(requestExit).toHaveBeenCalledTimes(1);
  });

  it("turns handler exceptions into an error notice", async () => {
    const { ctx, notices, retry } = fakeContext();
    retry.mockRejectedValue(new Error("store unavailable"));
    await dispatchCommand("/retry t-1", ctx);
    expect(notices[0]).toEqual({ text: "store unavailable", tone: "error" });
  });
});

describe("buildManualTask", () => {
  it("truncates a long first line to the title and keeps the full description", () => {
    const longLine = "x".repeat(80);
    const description = `${longLine}\nsecond line`;
    const task = buildManualTask(description);
    expect(task.title).toHaveLength(60);
    expect(task.title.endsWith("…")).toBe(true);
    expect(task.description).toBe(description);
  });

  it("generates unique ids", () => {
    const first = buildManualTask("a");
    const second = buildManualTask("a");
    expect(first.id).not.toBe(second.id);
  });
});

describe("COMMANDS", () => {
  it("has unique names and summaries for /help", () => {
    const names = COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const command of COMMANDS) expect(command.summary).not.toBe("");
  });
});
