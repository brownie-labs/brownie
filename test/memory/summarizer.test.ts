import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResult, Task } from "../../src/types.js";
import {
  buildSummarizerConfig,
  createExecutorReporterSpy,
  createTempDir,
  removeTempDir,
  type ExecutorReporterSpy,
} from "../helpers.js";

const mocks = vi.hoisted(() => ({
  runSession: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("../../src/runner.js", () => ({ runSession: mocks.runSession }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: mocks.readFile,
}));

const { SessionSummarizer } = await import("../../src/memory/summarizer.js");
const { MemoryStore } = await import("../../src/memory/store.js");
type MemoryStoreType = import("../../src/memory/store.js").MemoryStore;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "redmine-1",
    title: "Fix export",
    description: "CSV export returns 500.",
    status: "in_progress",
    attempts: 1,
    createdAt: "2026-07-02T10:00:00.000Z",
    updatedAt: "2026-07-02T10:05:00.000Z",
    ...overrides,
  };
}

function executorResult(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    ok: true,
    durationMs: 5000,
    sessionId: "executor-session",
    ...overrides,
  };
}

function summarySessionResult(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    ok: true,
    durationMs: 700,
    costUsd: 0.01,
    sessionId: "summary-session",
    resultText: '```json\n{"headline": "Headline", "summary": "Details."}\n```',
    ...overrides,
  };
}

describe("SessionSummarizer", () => {
  let dir: string;
  let store: MemoryStoreType;
  let spy: ExecutorReporterSpy;
  const logPath = "/logs/executor/2026-07-02/10-00-00-executor-session.log";
  const resolveLogPath = vi.fn();

  function buildSummarizer() {
    return new SessionSummarizer({
      command: "claude",
      summarizer: buildSummarizerConfig({ sessionTimeoutMs: 60_000 }),
      streamPartial: false,
      cwd: "/workspace",
      childEnv: {},
      store,
      resolveLogPath,
      reporter: spy.reporter,
    });
  }

  beforeEach(async () => {
    dir = await createTempDir();
    store = MemoryStore.open(join(dir, "memory.db"));
    spy = createExecutorReporterSpy();
    resolveLogPath.mockReset().mockResolvedValue(logPath);
    mocks.readFile.mockReset().mockResolvedValue("summarizer system\n");
    mocks.runSession.mockReset().mockResolvedValue(summarySessionResult());
  });

  afterEach(async () => {
    store.close();
    await removeTempDir(dir);
  });

  it("runs the summarizer session and saves a record to memory", async () => {
    await buildSummarizer().summarize(
      task(),
      executorResult(),
      { willRetry: false },
      new AbortController().signal,
    );

    expect(spy.summaryStarted).toHaveBeenCalledOnce();
    expect(resolveLogPath).toHaveBeenCalledWith("executor-session");

    const spec = mocks.runSession.mock.calls[0]?.[0] as {
      model: string;
      effort: string;
      systemPrompt: string;
      prompt: string;
      sessionTimeoutMs: number;
      mcpConfig?: string;
      jsonSchema: string;
      events: unknown;
    };
    expect(spec.model).toBe("haiku");
    expect(spec.effort).toBe("low");
    expect(spec.systemPrompt).toBe("summarizer system\n");
    expect(spec.prompt).toContain("ID: redmine-1");
    expect(spec.prompt).toContain(logPath);
    expect(spec.sessionTimeoutMs).toBe(60_000);
    expect(spec.mcpConfig).toBeUndefined();
    expect(spec.jsonSchema).toContain('"headline"');
    expect(spec.events).toBe(spy.reporter.session);

    const records = store.get("redmine-1");
    expect(records).toHaveLength(1);
    expect(records[0]?.headline).toBe("Headline");
    expect(records[0]?.summary).toBe("Details.");
    expect(records[0]?.ok).toBe(true);
    expect(records[0]?.sessionId).toBe("executor-session");

    expect(spy.summaryFinished).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "redmine-1", ok: true, costUsd: 0.01 }),
    );
  });

  it("saves the task failure along with its error", async () => {
    await buildSummarizer().summarize(
      task({ attempts: 2 }),
      executorResult({ ok: false, error: "session timeout" }),
      { willRetry: true },
      new AbortController().signal,
    );

    const records = store.get("redmine-1");
    expect(records[0]?.ok).toBe(false);
    expect(records[0]?.error).toBe("session timeout");
    expect(records[0]?.attempt).toBe(2);

    const spec = mocks.runSession.mock.calls[0]?.[0] as { prompt: string };
    expect(spec.prompt).toContain("Retry scheduled: yes");
  });

  it("skips the summary when the executor session has no id", async () => {
    await buildSummarizer().summarize(
      task(),
      executorResult({ sessionId: undefined }),
      { willRetry: false },
      new AbortController().signal,
    );

    expect(mocks.runSession).not.toHaveBeenCalled();
    expect(store.get("redmine-1")).toHaveLength(0);
    expect(spy.summaryFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining("no log") as unknown,
      }),
    );
  });

  it("skips the summary when the log path cannot be resolved", async () => {
    resolveLogPath.mockResolvedValue(undefined);

    await buildSummarizer().summarize(
      task(),
      executorResult(),
      { willRetry: false },
      new AbortController().signal,
    );

    expect(mocks.runSession).not.toHaveBeenCalled();
    expect(spy.summaryFinished).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    );
  });

  it("reports an error on a broken report and saves nothing", async () => {
    mocks.runSession.mockResolvedValue(
      summarySessionResult({ resultText: "this is not json" }),
    );

    await buildSummarizer().summarize(
      task(),
      executorResult(),
      { willRetry: false },
      new AbortController().signal,
    );

    expect(store.get("redmine-1")).toHaveLength(0);
    expect(spy.summaryFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: "invalid summary report",
      }),
    );
  });

  it("reports the error of a failed summarizer session", async () => {
    mocks.runSession.mockResolvedValue(
      summarySessionResult({ ok: false, error: "API Error", resultText: undefined }),
    );

    await buildSummarizer().summarize(
      task(),
      executorResult(),
      { willRetry: false },
      new AbortController().signal,
    );

    expect(store.get("redmine-1")).toHaveLength(0);
    expect(spy.summaryFinished).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "API Error" }),
    );
  });

  it("does not propagate exceptions — reports them via the reporter", async () => {
    mocks.runSession.mockRejectedValue(new Error("failure"));

    await expect(
      buildSummarizer().summarize(
        task(),
        executorResult(),
        { willRetry: false },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();

    expect(spy.summaryFinished).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "failure" }),
    );
  });

  it("after an abort saves no result and does not report", async () => {
    const controller = new AbortController();
    mocks.runSession.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(summarySessionResult());
    });

    await buildSummarizer().summarize(
      task(),
      executorResult(),
      { willRetry: false },
      controller.signal,
    );

    expect(store.get("redmine-1")).toHaveLength(0);
    expect(spy.summaryFinished).not.toHaveBeenCalled();
  });

  it("does nothing with an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await buildSummarizer().summarize(
      task(),
      executorResult(),
      { willRetry: false },
      controller.signal,
    );

    expect(spy.summaryStarted).not.toHaveBeenCalled();
    expect(mocks.runSession).not.toHaveBeenCalled();
  });
});
