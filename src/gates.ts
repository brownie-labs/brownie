import type { AuthGate } from "./auth-gate.js";
import type { UsageLimitGate } from "./usage-limit.js";

export interface LoopGates {
  limit: UsageLimitGate;
  auth: AuthGate;
}
