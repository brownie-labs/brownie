import { describe, expect, it } from "vitest";
import {
  detectStall,
  formatAge,
  formatControlLabel,
  formatCountdown,
  formatExecutorOutcome,
  formatExecutorPhase,
  formatHeaderStats,
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

  it("usage limit with countdown to the reset", () => {
    const label = formatMonitorPhase({ kind: "limitWait", resumeAt: now + 90_000 }, now);
    expect(label).toContain("usage limit reached");
    expect(label).toContain("01:30");
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

  it("usage limit with countdown to the reset", () => {
    const label = formatExecutorPhase({ kind: "limitWait", resumeAt: now + 90_000 }, now);
    expect(label).toContain("usage limit reached");
    expect(label).toContain("01:30");
  });
});

describe("detectStall", () => {
  const now = 1_000_000;

  it("returns undefined below the threshold", () => {
    expect(detectStall(now - 119_000, undefined, now)).toBeUndefined();
  });

  it("measures from the session start when there are no events yet", () => {
    expect(detectStall(now - 180_000, undefined, now)).toBe("⚠ no output for 3 min");
  });

  it("measures from the last event when one arrived", () => {
    expect(detectStall(now - 600_000, now - 125_000, now)).toBe(
      "⚠ no output for 2 min 5 s",
    );
  });

  it("returns undefined right after an event", () => {
    expect(detectStall(now - 600_000, now - 1_000, now)).toBeUndefined();
  });
});

describe("formatHeaderStats", () => {
  it("formats uptime, cost, cycles and per-status task counts", () => {
    const label = formatHeaderStats(
      { cycles: 3, tasksSucceeded: 2, tasksFailed: 1, totalCostUsd: 1.234 },
      [
        task(),
        { ...task(), id: "t-2", status: "pending" },
        { ...task(), id: "t-3", status: "done" },
        { ...task(), id: "t-4", status: "failed" },
        { ...task(), id: "t-5", status: "cancelled" },
      ],
      3_660_000,
    );
    expect(label).toBe(
      "↑ 1 h 1 min · $1.23 · 3 cycles · tasks 1 pending / 1 running / 1 done / 1 failed",
    );
  });

  it("formats the zero state", () => {
    const label = formatHeaderStats(
      { cycles: 0, tasksSucceeded: 0, tasksFailed: 0, totalCostUsd: 0 },
      [],
      0,
    );
    expect(label).toBe(
      "↑ 0 s · $0.00 · 0 cycles · tasks 0 pending / 0 running / 0 done / 0 failed",
    );
  });
});

describe("formatControlLabel", () => {
  it("returns nothing while running", () => {
    expect(formatControlLabel("running", "session", "▶ cycle #1")).toBeUndefined();
  });

  it("shows finishing with the phase label while pausing during a session", () => {
    expect(formatControlLabel("pausing", "session", "▶ cycle #1")).toBe(
      "⏸ finishing · ▶ cycle #1",
    );
    expect(formatControlLabel("pausing", "summary", "✎ summarizing t-1")).toBe(
      "⏸ finishing · ✎ summarizing t-1",
    );
  });

  it("shows pausing and paused outside a session", () => {
    expect(formatControlLabel("pausing", "sleeping", "⏳ next cycle in 01:00")).toBe(
      "⏸ pausing…",
    );
    expect(formatControlLabel("paused", "sleeping", "whatever")).toBe("⏸ paused");
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-07-02T12:00:00Z");

  it("shows just now under a minute", () => {
    expect(formatAge(new Date(now - 30_000).toISOString(), now)).toBe("just now");
  });

  it("shows minutes", () => {
    expect(formatAge(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5m ago");
  });

  it("shows hours", () => {
    expect(formatAge(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h ago");
  });

  it("shows days", () => {
    expect(formatAge(new Date(now - 49 * 3_600_000).toISOString(), now)).toBe("2d ago");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatAge("not-a-date", now)).toBe("");
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
    expect(label).toBe("✔ cycle #2 · 1.5s · $0.0123 · +3 tasks · 1 duplicate skipped");
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
    expect(label).toBe("✖ cycle #3 · 0.5s · invalid task report");
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
    expect(label).toBe("✔ t-1 · 2.0s · $0.5000 · 7 turns");
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
    expect(label).toBe("✖ t-2 · 0.1s · Session timed out");
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
      "↻ t-3 · 0.1s · Session ended with an error (is_error) · retry 1/3",
    );
  });
});
