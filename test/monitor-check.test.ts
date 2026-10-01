import { describe, expect, it, vi } from "vitest";
import { AgentController } from "../src/control.js";
import {
  CHECK_WHILE_DRAINING,
  CHECK_WHILE_PAUSED,
  requestMonitorCheck,
  type MonitorCheckDeps,
} from "../src/monitor-check.js";
import type { MonitorPhase } from "../src/status.js";

function depsWith(
  phase: MonitorPhase,
  overrides: Partial<MonitorCheckDeps> = {},
): MonitorCheckDeps & { control: AgentController } {
  return {
    control: new AgentController(() => undefined),
    phase: () => phase,
    draining: () => false,
    ...overrides,
  } as MonitorCheckDeps & { control: AgentController };
}

describe("requestMonitorCheck", () => {
  it.each<MonitorPhase>([
    { kind: "starting" },
    { kind: "sleeping", nextCycleAt: 1_000 },
    { kind: "offHours", resumeAt: 1_000 },
  ])("requests a run while the monitor is $kind", (phase) => {
    const deps = depsWith(phase);

    expect(requestMonitorCheck(deps)).toEqual({ kind: "requested" });
    expect(deps.control.runRequested).toBe(true);
  });

  it("reports the cycle already running without requesting another", () => {
    const deps = depsWith({ kind: "session", cycle: 5, startedAt: 0 });

    expect(requestMonitorCheck(deps)).toEqual({ kind: "running", cycle: 5 });
    expect(deps.control.runRequested).toBe(false);
  });

  it("refuses while the usage limit holds and names its end", () => {
    const resumeAt = Date.parse("2026-10-01T12:00:00.000Z");
    const deps = depsWith({ kind: "limitWait", resumeAt });

    expect(requestMonitorCheck(deps)).toEqual({
      kind: "refused",
      reason: "The monitor waits for the usage limit until 2026-10-01T12:00:00.000Z.",
    });
    expect(deps.control.runRequested).toBe(false);
  });

  it("refuses a paused monitor and leaves it paused", () => {
    const deps = depsWith({ kind: "sleeping", nextCycleAt: 1_000 });
    deps.control.pause();

    expect(requestMonitorCheck(deps)).toEqual({
      kind: "refused",
      reason: CHECK_WHILE_PAUSED,
    });
    expect(deps.control.runRequested).toBe(false);
  });

  it("refuses while the worker drains, before looking at the phase", () => {
    const phase = vi.fn((): MonitorPhase => ({ kind: "sleeping", nextCycleAt: 1_000 }));
    const deps = depsWith({ kind: "starting" }, { phase, draining: () => true });

    expect(requestMonitorCheck(deps)).toEqual({
      kind: "refused",
      reason: CHECK_WHILE_DRAINING,
    });
    expect(phase).not.toHaveBeenCalled();
  });
});
