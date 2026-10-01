import type { AgentController } from "./control.js";
import type { MonitorPhase } from "./status.js";

export type MonitorCheckRefusal =
  { reason: "paused" } | { reason: "draining" } | { reason: "limited"; until: number };

export type MonitorCheckOutcome =
  | { kind: "requested" }
  | { kind: "running"; cycle: number }
  | ({ kind: "refused" } & MonitorCheckRefusal);

export interface MonitorCheckDeps {
  control: Pick<AgentController, "state" | "requestRun">;
  phase(): MonitorPhase;
  draining(): boolean;
}

export function describeMonitorCheckRefusal(refusal: MonitorCheckRefusal): string {
  switch (refusal.reason) {
    case "paused":
      return "The monitor is paused. Resume it to run a cycle.";
    case "draining":
      return "The worker is draining and starts no new cycle.";
    case "limited":
      return `The monitor waits for the usage limit until ${new Date(refusal.until).toISOString()}.`;
  }
}

export function requestMonitorCheck(deps: MonitorCheckDeps): MonitorCheckOutcome {
  if (deps.draining()) return { kind: "refused", reason: "draining" };
  if (deps.control.state !== "running") return { kind: "refused", reason: "paused" };
  const phase = deps.phase();
  if (phase.kind === "session") return { kind: "running", cycle: phase.cycle };
  if (phase.kind === "limitWait") {
    return { kind: "refused", reason: "limited", until: phase.resumeAt };
  }
  deps.control.requestRun();
  return { kind: "requested" };
}
