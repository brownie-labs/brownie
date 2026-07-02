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
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    title: "Posprzątać repo",
    description: "Opis",
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

  it("pokazuje parametry obu agentów w nagłówku", () => {
    const store = createStore();
    const config = buildConfig({ cwd: "/tmp/ws" });
    const { lastFrame, unmount } = render(<Dashboard store={store} config={config} />);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("monitor");
    expect(frame).toContain("model=haiku");
    expect(frame).toContain("interwał=5 min");
    expect(frame).toContain("godziny pracy=całą dobę");
    expect(frame).toContain("egzekutor");
    expect(frame).toContain("model=opus");
    expect(frame).toContain("cwd=/tmp/ws");

    unmount();
    store.dispose();
  });

  it("pokazuje fazy: start monitora i oczekiwanie egzekutora", () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("uruchamianie…");
    expect(frame).toContain("oczekiwanie na zadania");

    unmount();
    store.dispose();
  });

  it("po zdarzeniach reportera pokazuje cykl, tail sesji i wynik", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.monitor.cycleStarted(2);
    store.monitor.session({ type: "text", text: "Sprawdzam zaległości" });
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
    expect(frame).toContain("cykl #2");
    expect(frame).toContain("Sprawdzam zaległości");
    expect(frame).toContain("🔧 Bash git log");
    expect(frame).toContain("nowe zadania: 1");

    unmount();
    store.dispose();
  });

  it("pokazuje tabelę zadań z licznikami i błędem nieudanego zadania", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.setTasks([
      buildTask(),
      buildTask({ id: "t-2", title: "Wdrożyć zmiany", status: "in_progress" }),
      buildTask({ id: "t-3", title: "Zbudować raport", status: "done" }),
      buildTask({
        id: "t-4",
        title: "Naprawić testy",
        status: "failed",
        error: "timeout",
      }),
    ]);
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("oczekujące: 1");
    expect(frame).toContain("w toku: 1");
    expect(frame).toContain("wykonane: 1");
    expect(frame).toContain("nieudane: 1");
    expect(frame).toContain("t-2 · Wdrożyć zmiany");
    expect(frame).toContain("t-4 · Naprawić testy — timeout");

    unmount();
    store.dispose();
  });

  it("pokazuje pustą tabelę z komunikatem o braku zadań", () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    expect(lastFrame()).toContain("brak zadań");

    unmount();
    store.dispose();
  });

  it("pokazuje komunikat zamykania po sygnale", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.shutdownRequested("SIGINT");
    await flushed(store);

    expect(lastFrame()).toContain("Otrzymano SIGINT — zamykanie…");

    unmount();
    store.dispose();
  });

  it("odlicza czas do kolejnego cyklu co sekundę", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.monitor.sleepUntil(new Date(Date.now() + 90_000));
    store.flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(lastFrame()).toContain("następny cykl za 01:30");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(lastFrame()).toContain("następny cykl za 01:2");

    unmount();
    store.dispose();
  });

  it("pokazuje wynik nieudanego zadania egzekutora", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.executor.taskStarted(buildTask({ status: "in_progress" }));
    store.executor.taskFinished({
      taskId: "t-1",
      title: "Posprzątać repo",
      ok: false,
      durationMs: 300,
      error: "Sesja zakończona błędem (is_error)",
    });
    store.executor.waiting();
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("✖ t-1");
    expect(frame).toContain("Sesja zakończona błędem");

    unmount();
    store.dispose();
  });

  it("pokazuje backoff z zaplanowanym ponowieniem po błędzie przejściowym", async () => {
    const store = createStore();
    const { lastFrame, unmount } = render(
      <Dashboard store={store} config={buildConfig()} />,
    );

    store.executor.taskFinished({
      taskId: "t-1",
      title: "Posprzątać repo",
      ok: false,
      durationMs: 300,
      error: "Sesja zakończona błędem (is_error)",
      willRetry: true,
      attempt: 1,
      maxAttempts: 3,
    });
    store.executor.retryScheduled(buildTask(), new Date(Date.now() + 30_000));
    await flushed(store);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("↻ ponowienie t-1 za");
    expect(frame).toContain("↻ t-1 · czas=0.3s");

    unmount();
    store.dispose();
  });
});
