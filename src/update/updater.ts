import { packageName, packageVersion } from "../paths.js";
import {
  detectInstallMethod,
  runInstall,
  type InstallMethod,
  type InstallResult,
} from "./install.js";
import { fetchLatestVersion } from "./registry.js";
import { isNewer } from "./version.js";

export interface UpdateDeps {
  name: string;
  current: string;
  fetchLatest: (name: string) => Promise<string | null>;
  detect: () => InstallMethod;
  install: (
    method: Exclude<InstallMethod, "unknown">,
    name: string,
  ) => Promise<InstallResult>;
}

export function defaultUpdateDeps(overrides: Partial<UpdateDeps> = {}): UpdateDeps {
  return {
    name: packageName(),
    current: packageVersion(),
    fetchLatest: (name) => fetchLatestVersion(name),
    detect: () => detectInstallMethod(),
    install: (method, name) => runInstall(method, name),
    ...overrides,
  };
}

export interface UpdateCheck {
  current: string;
  latest: string | null;
  newer: boolean;
  method: InstallMethod;
}

export async function checkForUpdate(deps: UpdateDeps): Promise<UpdateCheck> {
  const latest = await deps.fetchLatest(deps.name);
  return {
    current: deps.current,
    latest,
    newer: latest !== null && isNewer(deps.current, latest),
    method: deps.detect(),
  };
}

export type UpdateStatusKind =
  "up-to-date" | "updated" | "available" | "failed" | "unmanaged" | "unreachable";

export interface UpdateOutcome {
  status: UpdateStatusKind;
  from: string;
  to?: string | undefined;
  method: InstallMethod;
  output?: string | undefined;
}

export async function performUpdate(
  deps: UpdateDeps,
  options: { install: boolean },
): Promise<UpdateOutcome> {
  const check = await checkForUpdate(deps);
  const base = { from: check.current, method: check.method };

  if (check.latest === null) return { ...base, status: "unreachable" };
  if (!check.newer) return { ...base, status: "up-to-date", to: check.latest };
  if (!options.install) return { ...base, status: "available", to: check.latest };
  if (check.method === "unknown") {
    return { ...base, status: "unmanaged", to: check.latest };
  }

  const result = await deps.install(check.method, deps.name);
  return {
    ...base,
    status: result.ok ? "updated" : "failed",
    to: check.latest,
    output: result.output,
  };
}
