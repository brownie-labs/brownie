import { describe, expect, it } from "vitest";
import { buildControlStatus, parseControlRequest } from "../src/control-protocol.js";
import type { WorkerStatus } from "../src/status.js";
import type { Task } from "../src/types.js";

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

function buildSnapshot(overrides: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    startedAt: Date.parse("2026-07-08T08:00:00.000Z"),
    monitor: {
      phase: { kind: "starting" },
      control: "running",
      tail: [],
      recentOutcomes: [],
    },
    executor: {
      phase: { kind: "waiting" },
      control: "running",
      tail: [],
      recentOutcomes: [],
    },
    tasks: [],
    stats: { cycles: 0, tasksSucceeded: 0, tasksFailed: 0, totalCostUsd: 0 },
    ...overrides,
  };
}

describe("parseControlRequest", () => {
  it("parses the three commands", () => {
    expect(parseControlRequest('{"cmd":"status"}')).toEqual({ cmd: "status" });
    expect(parseControlRequest('{"cmd":"pause","agent":"monitor"}')).toEqual({
      cmd: "pause",
      agent: "monitor",
    });
    expect(parseControlRequest('{"cmd":"resume","agent":"all"}')).toEqual({
      cmd: "resume",
      agent: "all",
    });
  });

  it("rejects malformed input", () => {
    expect(parseControlRequest("not json")).toBeNull();
    expect(parseControlRequest("42")).toBeNull();
    expect(parseControlRequest('{"cmd":"shutdown"}')).toBeNull();
    expect(parseControlRequest('{"cmd":"pause"}')).toBeNull();
    expect(parseControlRequest('{"cmd":"pause","agent":"summarizer"}')).toBeNull();
  });
});

describe("buildControlStatus", () => {
  const context = {
    version: "1.2.3",
    pid: 4242,
    projectDir: "/srv/project",
    headless: true,
  };

  it("maps worker identity, stats and task counts", () => {
    const snapshot = buildSnapshot({
      tasks: [
        buildTask(),
        buildTask({ id: "t-2", status: "done" }),
        buildTask({ id: "t-3", status: "done" }),
        buildTask({ id: "t-4", status: "failed" }),
        buildTask({ id: "t-5", status: "in_progress" }),
      ],
      stats: { cycles: 7, tasksSucceeded: 2, tasksFailed: 1, totalCostUsd: 1.5 },
    });

    const status = buildControlStatus({ ...context, snapshot });

    expect(status).toMatchObject({
      version: "1.2.3",
      pid: 4242,
      startedAt: "2026-07-08T08:00:00.000Z",
      projectDir: "/srv/project",
      headless: true,
      stats: { cycles: 7, tasksSucceeded: 2, tasksFailed: 1, totalCostUsd: 1.5 },
      taskCounts: { pending: 1, in_progress: 1, done: 2, failed: 1, cancelled: 0 },
    });
  });

  it("serializes monitor phases with ISO timestamps", () => {
    const resumeAt = Date.parse("2026-07-08T09:00:00.000Z");
    const session = buildControlStatus({
      ...context,
      snapshot: buildSnapshot({
        monitor: {
          phase: { kind: "session", cycle: 3, startedAt: resumeAt },
          control: "running",
          tail: [],
          recentOutcomes: [],
        },
      }),
    });
    expect(session.agents.monitor.phase).toEqual({
      kind: "session",
      since: "2026-07-08T09:00:00.000Z",
      cycle: 3,
    });

    const sleeping = buildControlStatus({
      ...context,
      snapshot: buildSnapshot({
        monitor: {
          phase: { kind: "sleeping", nextCycleAt: resumeAt },
          control: "running",
          tail: [],
          recentOutcomes: [],
        },
      }),
    });
    expect(sleeping.agents.monitor.phase).toEqual({
      kind: "sleeping",
      until: "2026-07-08T09:00:00.000Z",
    });

    const limitWait = buildControlStatus({
      ...context,
      snapshot: buildSnapshot({
        monitor: {
          phase: { kind: "limitWait", resumeAt },
          control: "running",
          tail: [],
          recentOutcomes: [],
        },
      }),
    });
    expect(limitWait.agents.monitor.phase).toEqual({
      kind: "limitWait",
      until: "2026-07-08T09:00:00.000Z",
    });
  });

  it("serializes executor phases with the task identity", () => {
    const at = Date.parse("2026-07-08T09:00:00.000Z");
    const task = buildTask();

    const session = buildControlStatus({
      ...context,
      snapshot: buildSnapshot({
        executor: {
          phase: { kind: "session", task, startedAt: at },
          control: "running",
          tail: [],
          recentOutcomes: [],
        },
      }),
    });
    expect(session.agents.executor.phase).toEqual({
      kind: "session",
      since: "2026-07-08T09:00:00.000Z",
      taskId: "task-1",
      title: "Fix the bug",
    });

    const backoff = buildControlStatus({
      ...context,
      snapshot: buildSnapshot({
        executor: {
          phase: { kind: "backoff", task, resumeAt: at },
          control: "paused",
          tail: [],
          recentOutcomes: [],
        },
      }),
    });
    expect(backoff.agents.executor.phase).toEqual({
      kind: "backoff",
      until: "2026-07-08T09:00:00.000Z",
      taskId: "task-1",
      title: "Fix the bug",
    });
    expect(backoff.agents.executor.control).toBe("paused");
  });

  it("caps recent outcomes at five entries", () => {
    const outcome = {
      cycle: 1,
      ok: true,
      durationMs: 10,
      addedTasks: 0,
      skippedDuplicates: 0,
      finishedAt: 1,
    };
    const status = buildControlStatus({
      ...context,
      snapshot: buildSnapshot({
        monitor: {
          phase: { kind: "starting" },
          control: "running",
          tail: [],
          recentOutcomes: Array.from({ length: 8 }, (_, index) => ({
            ...outcome,
            cycle: index + 1,
          })),
        },
      }),
    });

    expect(status.agents.monitor.recentOutcomes).toHaveLength(5);
    expect(status.agents.monitor.recentOutcomes[0]?.cycle).toBe(1);
  });
});
