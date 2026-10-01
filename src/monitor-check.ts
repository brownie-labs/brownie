import type { AgentController } from "./control.js";
import type { MonitorPhase } from "./status.js";

export type MonitorCheckOutcome =
  | { kind: "requested" }
  | { kind: "running"; cycle: number }
  | { kind: "refused"; reason: string };

export interface MonitorCheckDeps {
  control: Pick<AgentController, "state" | "requestRun">;
  phase(): MonitorPhase;
  draining(): boolean;
}

export const CHECK_WHILE_DRAINING = "The worker is draining and starts no new cycle.";
export const CHECK_WHILE_PAUSED = "The monitor is paused. Resume it to run a cycle.";

export function checkWhileLimited(resumeAt: number): string {
  return `The monitor waits for the usage limit until ${new Date(resumeAt).toISOString()}.`;
}

export function requestMonitorCheck(deps: MonitorCheckDeps): MonitorCheckOutcome {
  if (deps.draining()) return { kind: "refused", reason: CHECK_WHILE_DRAINING };
  if (deps.control.state !== "running") {
    return { kind: "refused", reason: CHECK_WHILE_PAUSED };
  }
  const phase = deps.phase();
  if (phase.kind === "session") return { kind: "running", cycle: phase.cycle };
  if (phase.kind === "limitWait") {
    return { kind: "refused", reason: checkWhileLimited(phase.resumeAt) };
  }
  deps.control.requestRun();
  return { kind: "requested" };
}
