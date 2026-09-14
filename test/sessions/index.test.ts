import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";
import {
  SessionIndex,
  type SessionRecord,
  type SessionStart,
} from "../../src/sessions/index.js";
import { createTempDir, removeTempDir } from "../helpers.js";

function buildStart(overrides: Partial<SessionStart> = {}): SessionStart {
  return {
    sessionId: "sess-1",
    agent: "executor",
    taskId: "ci-42",
    cycle: undefined,
    model: "opus",
    startedAt: "2026-09-14T15:44:12.531Z",
    logPath: "logs/executor/2026-09-14/17-44-12-sess-1.log",
    jsonlPath: "logs/executor/2026-09-14/17-44-12-sess-1.jsonl",
    ...overrides,
  };
}

describe("SessionIndex", () => {
  let dir: string;
  let db: DatabaseSync;
  let index: SessionIndex;

  beforeEach(async () => {
    dir = await createTempDir();
    db = new DatabaseSync(join(dir, "memory.db"));
    index = SessionIndex.on(db);
  });

  afterEach(async () => {
    db.close();
    await removeTempDir(dir);
  });

  it("records a started session with its paths and no outcome yet", () => {
    index.started(buildStart());

    expect(index.get("sess-1")).toEqual({
      sessionId: "sess-1",
      agent: "executor",
      taskId: "ci-42",
      model: "opus",
      startedAt: "2026-09-14T15:44:12.531Z",
      logPath: "logs/executor/2026-09-14/17-44-12-sess-1.log",
      jsonlPath: "logs/executor/2026-09-14/17-44-12-sess-1.jsonl",
      cycle: undefined,
      finishedAt: undefined,
      ok: undefined,
      failureReason: undefined,
      costUsd: undefined,
      numTurns: undefined,
    } satisfies SessionRecord);
  });

  it("keeps a monitor session's cycle and omits the task id", () => {
    index.started(
      buildStart({ sessionId: "m-1", agent: "monitor", taskId: undefined, cycle: 7 }),
    );

    const record = index.get("m-1");
    expect(record?.cycle).toBe(7);
    expect(record?.taskId).toBeUndefined();
    expect(JSON.parse(JSON.stringify(record))).not.toHaveProperty("taskId");
  });

  it("closes a session with its outcome", () => {
    index.started(buildStart());

    index.finished({
      sessionId: "sess-1",
      finishedAt: "2026-09-14T15:49:00.000Z",
      ok: true,
      costUsd: 0.4183,
      numTurns: 24,
    });

    expect(index.get("sess-1")).toMatchObject({
      finishedAt: "2026-09-14T15:49:00.000Z",
      ok: true,
      costUsd: 0.4183,
      numTurns: 24,
      failureReason: undefined,
    });
  });

  it("closes a killed session with a failure reason and no cost", () => {
    index.started(buildStart());

    index.finished({
      sessionId: "sess-1",
      finishedAt: "2026-09-14T15:49:00.000Z",
      ok: false,
      failureReason: "timeout",
    });

    expect(index.get("sess-1")).toMatchObject({
      ok: false,
      failureReason: "timeout",
      costUsd: undefined,
      numTurns: undefined,
    });
  });

  it("ignores a finish for a session it never saw start", () => {
    index.finished({
      sessionId: "ghost",
      finishedAt: "2026-09-14T15:49:00.000Z",
      ok: true,
    });

    expect(index.get("ghost")).toBeUndefined();
  });

  it("get returns undefined for an unknown session", () => {
    expect(index.get("nope")).toBeUndefined();
  });

  it("lists the newest first and honours the limit", () => {
    for (const [sessionId, startedAt] of [
      ["a", "2026-09-14T10:00:00.000Z"],
      ["b", "2026-09-14T11:00:00.000Z"],
      ["c", "2026-09-14T12:00:00.000Z"],
    ] as const) {
      index.started(buildStart({ sessionId, startedAt }));
    }

    expect(index.list({ limit: 20 }).map((record) => record.sessionId)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(index.list({ limit: 2 }).map((record) => record.sessionId)).toEqual([
      "c",
      "b",
    ]);
  });

  it("filters by agent and by task id", () => {
    index.started(buildStart({ sessionId: "e-1", agent: "executor", taskId: "ci-1" }));
    index.started(buildStart({ sessionId: "e-2", agent: "executor", taskId: "ci-2" }));
    index.started(
      buildStart({ sessionId: "m-1", agent: "monitor", taskId: undefined, cycle: 1 }),
    );

    expect(
      index.list({ agent: "monitor", limit: 20 }).map((record) => record.sessionId),
    ).toEqual(["m-1"]);
    expect(
      index.list({ taskId: "ci-2", limit: 20 }).map((record) => record.sessionId),
    ).toEqual(["e-2"]);
    expect(
      index
        .list({ agent: "executor", taskId: "ci-1", limit: 20 })
        .map((record) => record.sessionId),
    ).toEqual(["e-1"]);
  });

  it("pages with before as a keyset cursor over started_at", () => {
    for (const [sessionId, startedAt] of [
      ["a", "2026-09-14T10:00:00.000Z"],
      ["b", "2026-09-14T11:00:00.000Z"],
      ["c", "2026-09-14T12:00:00.000Z"],
    ] as const) {
      index.started(buildStart({ sessionId, startedAt }));
    }

    const first = index.list({ limit: 2 });
    const next = index.list({ limit: 2, before: first.at(-1)?.startedAt ?? "" });

    expect(first.map((record) => record.sessionId)).toEqual(["c", "b"]);
    expect(next.map((record) => record.sessionId)).toEqual(["a"]);
    expect(index.list({ limit: 2, before: "2026-09-14T10:00:00.000Z" })).toEqual([]);
  });

  it("a second start under the same id replaces the first", () => {
    index.started(buildStart());
    index.finished({
      sessionId: "sess-1",
      finishedAt: "2026-09-14T15:49:00.000Z",
      ok: true,
    });

    index.started(buildStart({ model: "sonnet", startedAt: "2026-09-14T16:00:00.000Z" }));

    expect(index.get("sess-1")).toMatchObject({
      model: "sonnet",
      startedAt: "2026-09-14T16:00:00.000Z",
      finishedAt: undefined,
      ok: undefined,
    });
    expect(index.list({ limit: 20 })).toHaveLength(1);
  });

  it("shares the memory store's connection and leaves its summaries alone", () => {
    const path = join(dir, "shared.db");
    const memory = MemoryStore.open(path);
    try {
      const shared = SessionIndex.on(memory.connection);
      shared.started(buildStart());
      memory.add({
        taskId: "ci-42",
        attempt: 1,
        ok: true,
        title: "Fix the build",
        headline: "Pinned the compiler",
        summary: "Details.",
        error: undefined,
        sessionId: "sess-1",
        createdAt: "2026-09-14T15:49:00.000Z",
      });

      expect(shared.get("sess-1")?.taskId).toBe("ci-42");
      expect(memory.recent(10)).toHaveLength(1);
    } finally {
      memory.close();
    }
  });
});
