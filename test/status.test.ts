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
    title: "Tytuł",
    description: "Opis",
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

  it("stan początkowy: monitor startuje, egzekutor czeka, brak zadań", () => {
    const store = createStore();
    const status = store.getSnapshot();
    expect(status.monitor.phase).toEqual({ kind: "starting" });
    expect(status.executor.phase).toEqual({ kind: "waiting" });
    expect(status.monitor.tail).toEqual([]);
    expect(status.tasks).toEqual([]);
    expect(status.shutdownSignal).toBeUndefined();
    store.dispose();
  });

  it("przechodzi przez fazy monitora", () => {
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

  it("przechodzi przez fazy egzekutora i zapisuje wynik zadania", () => {
    const store = createStore();
    const task = buildTask();
    store.executor.taskStarted(task);
    store.flush();
    const phase = store.getSnapshot().executor.phase;
    expect(phase.kind).toBe("session");
    if (phase.kind === "session") expect(phase.task.id).toBe("t-1");

    store.executor.taskFinished({
      taskId: "t-1",
      title: "Tytuł",
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

  it("zapisuje wynik cyklu monitora z czasem zakończenia", () => {
    const store = createStore();
    store.monitor.cycleFinished({
      cycle: 1,
      ok: false,
      durationMs: 500,
      costUsd: undefined,
      addedTasks: 0,
      skippedDuplicates: 0,
      error: "niepoprawny raport zadań",
    });
    store.flush();
    const outcome = store.getSnapshot().monitor.lastOutcome;
    expect(outcome).toMatchObject({
      cycle: 1,
      ok: false,
      error: "niepoprawny raport zadań",
    });
    expect(outcome?.finishedAt).toBeGreaterThan(0);
    store.dispose();
  });

  it("zdarzenia sesji trafiają do taila, init ustawia sessionId", () => {
    const store = createStore();
    store.monitor.session({
      type: "init",
      model: "haiku",
      sessionId: "sess-7",
      toolCount: 2,
    });
    store.monitor.session({ type: "text", text: "Sprawdzam repo" });
    store.monitor.session({ type: "toolUse", name: "Bash", input: "git status" });
    store.flush();
    const panel = store.getSnapshot().monitor;
    expect(panel.sessionId).toBe("sess-7");
    expect(panel.tail).toEqual([
      "init · model=haiku · session=sess-7 · narzędzia: 2",
      "Sprawdzam repo",
      "🔧 Bash git status",
    ]);
    store.dispose();
  });

  it("skleja delty partial i pokazuje otwartą linię jako ostatni element taila", () => {
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

  it("pomija zdarzenie text zdublowane przez wcześniejsze partiale", () => {
    const store = createStore();
    store.monitor.session({ type: "partial", text: "Raport gotowy" });
    store.monitor.session({ type: "text", text: "Raport gotowy" });
    store.flush();
    expect(store.getSnapshot().monitor.tail).toEqual(["Raport gotowy"]);
    store.dispose();
  });

  it("zdarzenie inne niż text przywraca dopisywanie kolejnych tekstów", () => {
    const store = createStore();
    store.monitor.session({ type: "partial", text: "pierwszy" });
    store.monitor.session({ type: "text", text: "pierwszy" });
    store.monitor.session({ type: "toolUse", name: "Bash", input: "ls" });
    store.monitor.session({ type: "text", text: "drugi" });
    store.flush();
    expect(store.getSnapshot().monitor.tail).toEqual(["pierwszy", "🔧 Bash ls", "drugi"]);
    store.dispose();
  });

  it("retryScheduled ustawia fazę backoff z czasem wznowienia", () => {
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

  it("nowa sesja czyści tail i sessionId", () => {
    const store = createStore();
    store.monitor.session({
      type: "init",
      model: "haiku",
      sessionId: "sess-1",
      toolCount: 0,
    });
    store.monitor.session({ type: "partial", text: "w toku" });
    store.monitor.cycleStarted(2);
    store.flush();
    const panel = store.getSnapshot().monitor;
    expect(panel.tail).toEqual([]);
    expect(panel.sessionId).toBeUndefined();
    store.dispose();
  });

  it("ogranicza tail do zadanego limitu", () => {
    const store = createStore({ tailLimit: 3 });
    for (let i = 1; i <= 5; i += 1) {
      store.executor.session({ type: "text", text: `linia ${i}` });
    }
    store.flush();
    expect(store.getSnapshot().executor.tail).toEqual(["linia 3", "linia 4", "linia 5"]);
    store.dispose();
  });

  it("przycina bardzo długie linie taila", () => {
    const store = createStore();
    store.monitor.session({ type: "text", text: "x".repeat(500) });
    store.flush();
    const [line] = store.getSnapshot().monitor.tail;
    expect(line?.length).toBeLessThanOrEqual(301);
    expect(line?.endsWith("…")).toBe(true);
    store.dispose();
  });

  it("zwraca stabilny snapshot między powiadomieniami", () => {
    const store = createStore();
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    store.monitor.cycleStarted(1);
    expect(store.getSnapshot()).toBe(first);
    store.flush();
    expect(store.getSnapshot()).not.toBe(first);
    store.dispose();
  });

  it("koalescuje serię zmian w jedno powiadomienie", () => {
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

  it("unsubscribe przestaje powiadamiać", () => {
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

  it("setTasks kopiuje zadania — późniejsza mutacja wejścia nie zmienia snapshotu", () => {
    const store = createStore();
    const task = buildTask();
    store.setTasks([task]);
    store.flush();
    task.status = "failed";
    expect(store.getSnapshot().tasks[0]?.status).toBe("pending");
    store.dispose();
  });

  it("shutdownRequested zapisuje nazwę sygnału", () => {
    const store = createStore();
    store.shutdownRequested("SIGINT");
    store.flush();
    expect(store.getSnapshot().shutdownSignal).toBe("SIGINT");
    store.dispose();
  });

  it("dispose anuluje zaplanowane powiadomienie", () => {
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
  it("formatuje wszystkie typy zdarzeń", () => {
    expect(
      formatSessionEvent({ type: "init", model: "haiku", sessionId: "s", toolCount: 1 }),
    ).toBe("init · model=haiku · session=s · narzędzia: 1");
    expect(formatSessionEvent({ type: "text", text: "abc" })).toBe("abc");
    expect(formatSessionEvent({ type: "toolUse", name: "Bash", input: "ls" })).toBe(
      "🔧 Bash ls",
    );
    expect(
      formatSessionEvent({ type: "toolResult", isError: false, content: "ok" }),
    ).toBe("↳ wynik ok");
    expect(
      formatSessionEvent({ type: "toolResult", isError: true, content: "boom" }),
    ).toBe("⚠ wynik(błąd) boom");
    expect(formatSessionEvent({ type: "raw", line: "x" })).toBe("(nie-JSON) x");
    expect(formatSessionEvent({ type: "stderr", line: "err" })).toBe("stderr: err");
    expect(formatSessionEvent({ type: "killing", reason: "timeout" })).toBe(
      "⏹ Zatrzymuję sesję (timeout)…",
    );
    expect(formatSessionEvent({ type: "procError", message: "pad" })).toBe("✖ pad");
  });
});
