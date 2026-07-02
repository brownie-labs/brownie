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
    title: "Napraw eksport",
    description: "Eksport CSV zwraca 500.",
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
    sessionId: "sesja-egzekutora",
    ...overrides,
  };
}

function summarySessionResult(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    ok: true,
    durationMs: 700,
    costUsd: 0.01,
    sessionId: "sesja-podsumowania",
    resultText: '```json\n{"headline": "Nagłówek", "summary": "Szczegóły."}\n```',
    ...overrides,
  };
}

describe("SessionSummarizer", () => {
  let dir: string;
  let store: MemoryStoreType;
  let spy: ExecutorReporterSpy;
  const logPath = "/logs/executor/2026-07-02/10-00-00-sesja-egzekutora.log";
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
    mocks.readFile.mockReset().mockResolvedValue("system podsumowującego\n");
    mocks.runSession.mockReset().mockResolvedValue(summarySessionResult());
  });

  afterEach(async () => {
    store.close();
    await removeTempDir(dir);
  });

  it("uruchamia sesję podsumowującą i zapisuje rekord do pamięci", async () => {
    await buildSummarizer().summarize(
      task(),
      executorResult(),
      { willRetry: false },
      new AbortController().signal,
    );

    expect(spy.summaryStarted).toHaveBeenCalledOnce();
    expect(resolveLogPath).toHaveBeenCalledWith("sesja-egzekutora");

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
    expect(spec.systemPrompt).toBe("system podsumowującego\n");
    expect(spec.prompt).toContain("ID: redmine-1");
    expect(spec.prompt).toContain(logPath);
    expect(spec.sessionTimeoutMs).toBe(60_000);
    expect(spec.mcpConfig).toBeUndefined();
    expect(spec.jsonSchema).toContain('"headline"');
    expect(spec.events).toBe(spy.reporter.session);

    const records = store.get("redmine-1");
    expect(records).toHaveLength(1);
    expect(records[0]?.headline).toBe("Nagłówek");
    expect(records[0]?.summary).toBe("Szczegóły.");
    expect(records[0]?.ok).toBe(true);
    expect(records[0]?.sessionId).toBe("sesja-egzekutora");

    expect(spy.summaryFinished).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "redmine-1", ok: true, costUsd: 0.01 }),
    );
  });

  it("zapisuje porażkę zadania razem z jego błędem", async () => {
    await buildSummarizer().summarize(
      task({ attempts: 2 }),
      executorResult({ ok: false, error: "timeout sesji" }),
      { willRetry: true },
      new AbortController().signal,
    );

    const records = store.get("redmine-1");
    expect(records[0]?.ok).toBe(false);
    expect(records[0]?.error).toBe("timeout sesji");
    expect(records[0]?.attempt).toBe(2);

    const spec = mocks.runSession.mock.calls[0]?.[0] as { prompt: string };
    expect(spec.prompt).toContain("Zaplanowano ponowną próbę: tak");
  });

  it("pomija podsumowanie, gdy sesja egzekutora nie ma identyfikatora", async () => {
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
        error: expect.stringContaining("brak logu") as unknown,
      }),
    );
  });

  it("pomija podsumowanie, gdy nie można ustalić ścieżki logu", async () => {
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

  it("zgłasza błąd przy zepsutym raporcie i niczego nie zapisuje", async () => {
    mocks.runSession.mockResolvedValue(
      summarySessionResult({ resultText: "to nie jest json" }),
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
        error: "niepoprawny raport podsumowania",
      }),
    );
  });

  it("zgłasza błąd nieudanej sesji podsumowującej", async () => {
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

  it("nie propaguje wyjątków — zgłasza je przez reporter", async () => {
    mocks.runSession.mockRejectedValue(new Error("awaria"));

    await expect(
      buildSummarizer().summarize(
        task(),
        executorResult(),
        { willRetry: false },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();

    expect(spy.summaryFinished).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "awaria" }),
    );
  });

  it("po przerwaniu nie zapisuje wyniku ani nie raportuje", async () => {
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

  it("z już przerwanym sygnałem nie robi nic", async () => {
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
