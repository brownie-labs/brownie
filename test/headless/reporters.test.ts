import { describe, expect, it } from "vitest";
import type { HeadlessLogEvent } from "../../src/headless/events.js";
import { createHeadlessReporters } from "../../src/headless/reporters.js";
import type { Task } from "../../src/types.js";

const RESUME_AT = new Date("2026-07-08T09:00:00.000Z");

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Fix the bug",
    description: "details",
    status: "pending",
    attempts: 0,
    createdAt: "2026-07-08T08:00:00.000Z",
    updatedAt: "2026-07-08T08:00:00.000Z",
    ...overrides,
  };
}

function collect(options: { verbose?: boolean } = {}) {
  const events: HeadlessLogEvent[] = [];
  const reporters = createHeadlessReporters((event) => events.push(event), options);
  return { events, ...reporters };
}

describe("createHeadlessReporters", () => {
  it("maps monitor lifecycle callbacks to events", () => {
    const { events, monitor } = collect();

    monitor.offHours(RESUME_AT);
    monitor.usageLimit(RESUME_AT);
    monitor.cycleStarted(3);
    monitor.sleepUntil(RESUME_AT);

    expect(events).toEqual([
      {
        level: "info",
        agent: "monitor",
        event: "monitor.offHours",
        fields: { resumeAt: RESUME_AT.toISOString() },
      },
      {
        level: "warn",
        agent: "monitor",
        event: "monitor.limitWait",
        fields: { resumeAt: RESUME_AT.toISOString() },
      },
      {
        level: "info",
        agent: "monitor",
        event: "cycle.started",
        fields: { cycle: 3 },
      },
      {
        level: "info",
        agent: "monitor",
        event: "monitor.sleeping",
        fields: { nextCycleAt: RESUME_AT.toISOString() },
      },
    ]);
  });

  it("reports a successful cycle at info level with compacted fields", () => {
    const { events, monitor } = collect();

    monitor.cycleFinished({
      cycle: 1,
      ok: true,
      durationMs: 2000,
      costUsd: 0.5,
      addedTasks: 2,
      skippedDuplicates: 1,
      error: undefined,
    });

    expect(events).toEqual([
      {
        level: "info",
        agent: "monitor",
        event: "cycle.finished",
        fields: {
          cycle: 1,
          ok: true,
          durationMs: 2000,
          costUsd: 0.5,
          addedTasks: 2,
          skippedDuplicates: 1,
        },
      },
    ]);
  });

  it("reports a failed cycle at error level", () => {
    const { events, monitor } = collect();

    monitor.cycleFinished({
      cycle: 2,
      ok: false,
      durationMs: 100,
      costUsd: undefined,
      addedTasks: 0,
      skippedDuplicates: 0,
      error: "session failed",
    });

    expect(events[0]).toMatchObject({
      level: "error",
      event: "cycle.finished",
      fields: { ok: false, error: "session failed" },
    });
    expect(events[0]?.fields).not.toHaveProperty("costUsd");
  });

  it("maps executor lifecycle callbacks to events", () => {
    const { events, executor } = collect();
    const task = buildTask();

    executor.taskStarted(task);
    executor.retryScheduled(task, RESUME_AT);
    executor.usageLimit(RESUME_AT);
    executor.waiting();

    expect(events).toEqual([
      {
        level: "info",
        agent: "executor",
        event: "task.started",
        fields: { taskId: "task-1", title: "Fix the bug" },
      },
      {
        level: "warn",
        agent: "executor",
        event: "task.retryScheduled",
        fields: { taskId: "task-1", resumeAt: RESUME_AT.toISOString() },
      },
      {
        level: "warn",
        agent: "executor",
        event: "executor.limitWait",
        fields: { resumeAt: RESUME_AT.toISOString() },
      },
      {
        level: "info",
        agent: "executor",
        event: "executor.waiting",
        fields: {},
      },
    ]);
  });

  it("grades task.finished by outcome: ok, retry, terminal failure", () => {
    const { events, executor } = collect();
    const base = {
      taskId: "task-1",
      title: "Fix the bug",
      durationMs: 1000,
      costUsd: undefined,
      numTurns: undefined,
      error: undefined,
      willRetry: undefined,
      attempt: undefined,
      maxAttempts: undefined,
    };

    executor.taskFinished({ ...base, ok: true, costUsd: 0.25, numTurns: 12 });
    executor.taskFinished({
      ...base,
      ok: false,
      willRetry: true,
      attempt: 1,
      maxAttempts: 3,
      error: "timeout",
    });
    executor.taskFinished({ ...base, ok: false, error: "fatal" });

    expect(events.map((event) => event.level)).toEqual(["info", "warn", "error"]);
    expect(events[0]?.fields).toEqual({
      taskId: "task-1",
      title: "Fix the bug",
      ok: true,
      durationMs: 1000,
      costUsd: 0.25,
      numTurns: 12,
    });
    expect(events[1]?.fields).toMatchObject({
      willRetry: true,
      attempt: 1,
      maxAttempts: 3,
      error: "timeout",
    });
  });

  it("keeps executor summary callbacks silent and routes them via the summarizer reporter", () => {
    const { events, executor, summarizer } = collect();
    const task = buildTask();

    executor.summaryStarted(task);
    executor.summaryFinished({
      taskId: task.id,
      ok: true,
      durationMs: 10,
      costUsd: undefined,
      error: undefined,
    });
    expect(events).toEqual([]);

    summarizer.summaryStarted(task);
    summarizer.summaryFinished({
      taskId: task.id,
      ok: false,
      durationMs: 20,
      costUsd: 0.01,
      error: "boom",
    });

    expect(events).toEqual([
      {
        level: "info",
        agent: "summarizer",
        event: "summary.started",
        fields: { taskId: "task-1" },
      },
      {
        level: "error",
        agent: "summarizer",
        event: "summary.finished",
        fields: {
          taskId: "task-1",
          ok: false,
          durationMs: 20,
          costUsd: 0.01,
          error: "boom",
        },
      },
    ]);
  });

  it("always logs session init, stderr, procError and killing", () => {
    const { events, monitor } = collect();

    monitor.session({ type: "init", model: "haiku", sessionId: "s-1", toolCount: 5 });
    monitor.session({ type: "stderr", line: "warning: deprecated" });
    monitor.session({ type: "procError", message: "spawn failed" });
    monitor.session({ type: "killing", reason: "timeout" });

    expect(events).toEqual([
      {
        level: "info",
        agent: "monitor",
        event: "session.init",
        fields: { model: "haiku", sessionId: "s-1" },
      },
      {
        level: "warn",
        agent: "monitor",
        event: "session.stderr",
        fields: { line: "warning: deprecated" },
      },
      {
        level: "error",
        agent: "monitor",
        event: "session.procError",
        fields: { message: "spawn failed" },
      },
      {
        level: "warn",
        agent: "monitor",
        event: "session.killed",
        fields: { reason: "timeout" },
      },
    ]);
  });

  it("suppresses session text, tool calls and results by default", () => {
    const { events, executor } = collect();

    executor.session({ type: "text", text: "thinking" });
    executor.session({ type: "toolUse", name: "Bash", input: { command: "ls" } });
    executor.session({ type: "toolResult", isError: true, lines: ["boom"], dropped: 0 });
    executor.session({ type: "partial", text: "chunk" });
    executor.session({ type: "raw", line: "{}" });

    expect(events).toEqual([]);
  });

  it("logs session text, tool calls and failed tool results when verbose", () => {
    const { events, executor } = collect({ verbose: true });

    executor.session({ type: "text", text: "thinking" });
    executor.session({ type: "toolUse", name: "Bash", input: { command: "ls -la" } });
    executor.session({ type: "toolResult", isError: true, lines: ["boom"], dropped: 0 });
    executor.session({ type: "toolResult", isError: false, lines: ["ok"], dropped: 0 });
    executor.session({ type: "partial", text: "chunk" });

    expect(events).toEqual([
      {
        level: "info",
        agent: "executor",
        event: "session.text",
        fields: { text: "thinking" },
      },
      {
        level: "info",
        agent: "executor",
        event: "session.tool",
        fields: { tool: "Bash", detail: "ls -la" },
      },
      {
        level: "warn",
        agent: "executor",
        event: "session.toolError",
        fields: { output: "boom" },
      },
    ]);
  });
});
