import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  formatExecutorOutcome,
  formatExecutorPhase,
  formatInterval,
  formatMonitorOutcome,
  formatMonitorPhase,
} from "../../src/ui/format.js";
import type { Task } from "../../src/types.js";

function task(): Task {
  return {
    id: "t-1",
    title: "Tytuł",
    description: "Opis",
    status: "in_progress",
    attempts: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("formatCountdown", () => {
  it("formatuje minuty i sekundy", () => {
    expect(formatCountdown(65_000)).toBe("01:05");
  });

  it("formatuje godziny", () => {
    expect(formatCountdown(3_665_000)).toBe("1:01:05");
  });

  it("nie schodzi poniżej zera", () => {
    expect(formatCountdown(-5_000)).toBe("00:00");
  });
});

describe("formatInterval", () => {
  it("formatuje pełne minuty", () => {
    expect(formatInterval(900_000)).toBe("15 min");
  });

  it("formatuje godziny z minutami", () => {
    expect(formatInterval(5_400_000)).toBe("1 h 30 min");
  });

  it("formatuje sekundy", () => {
    expect(formatInterval(45_000)).toBe("45 s");
  });

  it("zero pokazuje jako 0 s", () => {
    expect(formatInterval(0)).toBe("0 s");
  });
});

describe("formatMonitorPhase", () => {
  const now = Date.parse("2026-07-02T10:00:00");

  it("uruchamianie", () => {
    expect(formatMonitorPhase({ kind: "starting" }, now)).toBe("uruchamianie…");
  });

  it("poza godzinami z odliczaniem", () => {
    const label = formatMonitorPhase({ kind: "offHours", resumeAt: now + 60_000 }, now);
    expect(label).toContain("poza godzinami pracy");
    expect(label).toContain("01:00");
  });

  it("sesja z czasem trwania", () => {
    const label = formatMonitorPhase(
      { kind: "session", cycle: 4, startedAt: now - 2_500 },
      now,
    );
    expect(label).toContain("cykl #4");
    expect(label).toContain("2.5s");
  });

  it("sen z odliczaniem", () => {
    const label = formatMonitorPhase(
      { kind: "sleeping", nextCycleAt: now + 125_000 },
      now,
    );
    expect(label).toContain("następny cykl za 02:05");
  });
});

describe("formatExecutorPhase", () => {
  const now = Date.parse("2026-07-02T10:00:00");

  it("oczekiwanie", () => {
    expect(formatExecutorPhase({ kind: "waiting" }, now)).toContain("oczekiwanie");
  });

  it("sesja z zadaniem", () => {
    const label = formatExecutorPhase(
      { kind: "session", task: task(), startedAt: now - 1_000 },
      now,
    );
    expect(label).toContain("t-1");
    expect(label).toContain("Tytuł");
    expect(label).toContain("1.0s");
  });

  it("backoff z odliczaniem do ponowienia", () => {
    const label = formatExecutorPhase(
      { kind: "backoff", task: task(), resumeAt: now + 30_000 },
      now,
    );
    expect(label).toContain("↻ ponowienie t-1 za 00:30");
  });
});

describe("formatMonitorOutcome", () => {
  it("sukces z kosztem i duplikatami", () => {
    const label = formatMonitorOutcome({
      cycle: 2,
      ok: true,
      durationMs: 1_500,
      costUsd: 0.0123,
      addedTasks: 3,
      skippedDuplicates: 1,
      finishedAt: 0,
    });
    expect(label).toBe(
      "✔ cykl #2 · czas=1.5s · koszt=$0.0123 · nowe zadania: 3 · pominięte duplikaty: 1",
    );
  });

  it("błąd z opisem", () => {
    const label = formatMonitorOutcome({
      cycle: 3,
      ok: false,
      durationMs: 500,
      addedTasks: 0,
      skippedDuplicates: 0,
      error: "niepoprawny raport zadań",
      finishedAt: 0,
    });
    expect(label).toBe("✖ cykl #3 · czas=0.5s · niepoprawny raport zadań");
  });
});

describe("formatExecutorOutcome", () => {
  it("sukces z turami", () => {
    const label = formatExecutorOutcome({
      taskId: "t-1",
      title: "Tytuł",
      ok: true,
      durationMs: 2_000,
      costUsd: 0.5,
      numTurns: 7,
      finishedAt: 0,
    });
    expect(label).toBe("✔ t-1 · czas=2.0s · koszt=$0.5000 · tury=7");
  });

  it("błąd z opisem", () => {
    const label = formatExecutorOutcome({
      taskId: "t-2",
      title: "Tytuł",
      ok: false,
      durationMs: 100,
      error: "Przekroczono limit czasu sesji",
      finishedAt: 0,
    });
    expect(label).toBe("✖ t-2 · czas=0.1s · Przekroczono limit czasu sesji");
  });

  it("błąd przejściowy z zaplanowanym ponowieniem", () => {
    const label = formatExecutorOutcome({
      taskId: "t-3",
      title: "Tytuł",
      ok: false,
      durationMs: 100,
      error: "Sesja zakończona błędem (is_error)",
      willRetry: true,
      attempt: 1,
      maxAttempts: 3,
      finishedAt: 0,
    });
    expect(label).toBe(
      "↻ t-3 · czas=0.1s · Sesja zakończona błędem (is_error) · ponowienie (próba 1/3)",
    );
  });
});
