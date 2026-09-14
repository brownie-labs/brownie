import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { SESSION_FAILURE_REASONS, type SessionFailureReason } from "../types.js";

export const SESSION_AGENTS = ["monitor", "executor", "summarizer"] as const;

export type SessionAgent = (typeof SESSION_AGENTS)[number];

export const SESSIONS_LIMIT_DEFAULT = 20;
export const SESSIONS_LIMIT_MAX = 100;

export interface SessionMeta {
  agent: SessionAgent;
  taskId?: string | undefined;
  cycle?: number | undefined;
}

export interface SessionRecord {
  sessionId: string;
  agent: SessionAgent;
  taskId?: string | undefined;
  cycle?: number | undefined;
  model?: string | undefined;
  startedAt: string;
  finishedAt?: string | undefined;
  ok?: boolean | undefined;
  failureReason?: SessionFailureReason | undefined;
  costUsd?: number | undefined;
  numTurns?: number | undefined;
  logPath: string;
  jsonlPath: string;
}

export interface StartedSession extends SessionMeta {
  sessionId: string;
  model: string;
  startedAt: string;
}

export interface SessionStart extends StartedSession {
  logPath: string;
  jsonlPath: string;
}

export interface SessionFinish {
  sessionId: string;
  finishedAt: string;
  ok: boolean;
  failureReason?: SessionFailureReason | undefined;
  costUsd?: number | undefined;
  numTurns?: number | undefined;
}

export interface SessionRecorder {
  started(session: StartedSession): void;
  finished(session: SessionFinish): void;
}

export interface SessionListQuery {
  agent?: SessionAgent | undefined;
  taskId?: string | undefined;
  before?: string | undefined;
  limit: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  task_id TEXT,
  cycle INTEGER,
  model TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  failure_reason TEXT,
  cost_usd REAL,
  num_turns INTEGER,
  log_path TEXT NOT NULL,
  jsonl_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_agent_started ON sessions (agent, started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_task_id ON sessions (task_id);
`;

const rowSchema = z.object({
  session_id: z.string(),
  agent: z.enum(SESSION_AGENTS),
  task_id: z.string().nullable(),
  cycle: z.number().int().nullable(),
  model: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  ok: z.number().int().nullable(),
  failure_reason: z.enum(SESSION_FAILURE_REASONS).nullable(),
  cost_usd: z.number().nullable(),
  num_turns: z.number().int().nullable(),
  log_path: z.string(),
  jsonl_path: z.string(),
});

function toRecord(row: unknown): SessionRecord {
  const parsed = rowSchema.parse(row);
  return {
    sessionId: parsed.session_id,
    agent: parsed.agent,
    taskId: parsed.task_id ?? undefined,
    cycle: parsed.cycle ?? undefined,
    model: parsed.model ?? undefined,
    startedAt: parsed.started_at,
    finishedAt: parsed.finished_at ?? undefined,
    ok: parsed.ok === null ? undefined : parsed.ok !== 0,
    failureReason: parsed.failure_reason ?? undefined,
    costUsd: parsed.cost_usd ?? undefined,
    numTurns: parsed.num_turns ?? undefined,
    logPath: parsed.log_path,
    jsonlPath: parsed.jsonl_path,
  };
}

export class SessionIndex {
  private constructor(private readonly db: DatabaseSync) {}

  static on(db: DatabaseSync): SessionIndex {
    db.exec(SCHEMA);
    return new SessionIndex(db);
  }

  started(session: SessionStart): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions
           (session_id, agent, task_id, cycle, model, started_at, log_path, jsonl_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.sessionId,
        session.agent,
        session.taskId ?? null,
        session.cycle ?? null,
        session.model,
        session.startedAt,
        session.logPath,
        session.jsonlPath,
      );
  }

  finished(session: SessionFinish): void {
    this.db
      .prepare(
        `UPDATE sessions
            SET finished_at = ?, ok = ?, failure_reason = ?, cost_usd = ?, num_turns = ?
          WHERE session_id = ?`,
      )
      .run(
        session.finishedAt,
        session.ok ? 1 : 0,
        session.failureReason ?? null,
        session.costUsd ?? null,
        session.numTurns ?? null,
        session.sessionId,
      );
  }

  list(query: SessionListQuery): SessionRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (query.agent !== undefined) {
      conditions.push("agent = ?");
      params.push(query.agent);
    }
    if (query.taskId !== undefined) {
      conditions.push("task_id = ?");
      params.push(query.taskId);
    }
    if (query.before !== undefined) {
      conditions.push("started_at < ?");
      params.push(query.before);
    }
    const where = conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions${where}
          ORDER BY started_at DESC, session_id DESC
          LIMIT ?`,
      )
      .all(...params, query.limit);
    return rows.map(toRecord);
  }

  get(sessionId: string): SessionRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE session_id = ?`)
      .get(sessionId);
    return row === undefined ? undefined : toRecord(row);
  }
}
