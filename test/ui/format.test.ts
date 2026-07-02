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
    title: "Title",
    description: "Description",
    status: "in_progress",
    attempts: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("formatCountdown", () => {
  it("formats minutes and seconds", () => {
    expect(formatCountdown(65_000)).toBe("01:05");
  });

  it("formats hours", () => {
    expect(formatCountdown(3_665_000)).toBe("1:01:05");
  });

  it("does not go below zero", () => {
    expect(formatCountdown(-5_000)).toBe("00:00");
  });
});

describe("formatInterval", () => {
  it("formats whole minutes", () => {
    expect(formatInterval(900_000)).toBe("15 min");
  });

  it("formats hours with minutes", () => {
    expect(formatInterval(5_400_000)).toBe("1 h 30 min");
  });

  it("formats seconds", () => {
    expect(formatInterval(45_000)).toBe("45 s");
  });

  it("shows zero as 0 s", () => {
    expect(formatInterval(0)).toBe("0 s");
  });
});

describe("formatMonitorPhase", () => {
  const now = Date.parse("2026-07-02T10:00:00");

  it("starting", () => {
    expect(formatMonitorPhase({ kind: "starting" }, now)).toBe("starting…");
  });

  it("outside working hours with countdown", () => {
    const label = formatMonitorPhase({ kind: "offHours", resumeAt: now + 60_000 }, now);
    expect(label).toContain("outside working hours");
    expect(label).toContain("01:00");
  });

  it("session with duration", () => {
    const label = formatMonitorPhase(
      { kind: "session", cycle: 4, startedAt: now - 2_500 },
      now,
    );
    expect(label).toContain("cycle #4");
    expect(label).toContain("2.5s");
  });

  it("sleeping with countdown", () => {
    const label = formatMonitorPhase(
      { kind: "sleeping", nextCycleAt: now + 125_000 },
      now,
    );
    expect(label).toContain("next cycle in 02:05");
  });
});

describe("formatExecutorPhase", () => {
  const now = Date.parse("2026-07-02T10:00:00");

  it("waiting", () => {
    expect(formatExecutorPhase({ kind: "waiting" }, now)).toContain("waiting");
  });

  it("session with a task", () => {
    const label = formatExecutorPhase(
      { kind: "session", task: task(), startedAt: now - 1_000 },
      now,
    );
    expect(label).toContain("t-1");
    expect(label).toContain("Title");
    expect(label).toContain("1.0s");
  });

  it("backoff with countdown to retry", () => {
    const label = formatExecutorPhase(
      { kind: "backoff", task: task(), resumeAt: now + 30_000 },
      now,
    );
    expect(label).toContain("↻ retrying t-1 in 00:30");
  });

  it("summarizing session to memory", () => {
    const label = formatExecutorPhase(
      { kind: "summary", task: task(), startedAt: now - 2_000 },
      now,
    );
    expect(label).toContain("summarizing t-1");
    expect(label).toContain("2.0s");
  });
});

describe("formatMonitorOutcome", () => {
  it("success with cost and duplicates", () => {
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
      "✔ cycle #2 · time=1.5s · cost=$0.0123 · new tasks: 3 · skipped duplicates: 1",
    );
  });

  it("error with description", () => {
    const label = formatMonitorOutcome({
      cycle: 3,
      ok: false,
      durationMs: 500,
      addedTasks: 0,
      skippedDuplicates: 0,
      error: "invalid task report",
      finishedAt: 0,
    });
    expect(label).toBe("✖ cycle #3 · time=0.5s · invalid task report");
  });
});

describe("formatExecutorOutcome", () => {
  it("success with turns", () => {
    const label = formatExecutorOutcome({
      taskId: "t-1",
      title: "Title",
      ok: true,
      durationMs: 2_000,
      costUsd: 0.5,
      numTurns: 7,
      finishedAt: 0,
    });
    expect(label).toBe("✔ t-1 · time=2.0s · cost=$0.5000 · turns=7");
  });

  it("error with description", () => {
    const label = formatExecutorOutcome({
      taskId: "t-2",
      title: "Title",
      ok: false,
      durationMs: 100,
      error: "Session timed out",
      finishedAt: 0,
    });
    expect(label).toBe("✖ t-2 · time=0.1s · Session timed out");
  });

  it("transient error with a scheduled retry", () => {
    const label = formatExecutorOutcome({
      taskId: "t-3",
      title: "Title",
      ok: false,
      durationMs: 100,
      error: "Session ended with an error (is_error)",
      willRetry: true,
      attempt: 1,
      maxAttempts: 3,
      finishedAt: 0,
    });
    expect(label).toBe(
      "↻ t-3 · time=0.1s · Session ended with an error (is_error) · retry (attempt 1/3)",
    );
  });
});
