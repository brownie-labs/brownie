import { type GlobalConfig, isAutoUpdaterDisabled } from "../global-config.js";
import type { HeadlessLogEmitter } from "../headless/events.js";
import type { UpdateStatus } from "../status.js";
import { sleep } from "../timing.js";
import type { InstallMethod } from "./install.js";
import type { UpdateDeps } from "./updater.js";
import { isNewer } from "./version.js";

export const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;

export interface AutoUpdateOptions {
  globalConfig: GlobalConfig;
  deps: UpdateDeps;
  setUpdateStatus: (info: UpdateStatus) => void;
  emit?: HeadlessLogEmitter | null | undefined;
  signal: AbortSignal;
  intervalMs?: number | undefined;
  initialDelayMs?: number | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export async function runAutoUpdateLoop(options: AutoUpdateOptions): Promise<void> {
  const {
    globalConfig,
    deps,
    setUpdateStatus,
    emit,
    signal,
    intervalMs = UPDATE_CHECK_INTERVAL_MS,
    initialDelayMs = 0,
    env = process.env,
  } = options;

  if (isAutoUpdaterDisabled(env)) return;
  const method = deps.detect();
  if (method === "unknown") return;

  if (initialDelayMs > 0) await sleep(initialDelayMs, signal);

  let lastActioned: string | undefined;

  while (!signal.aborted) {
    try {
      const latest = await deps.fetchLatest(deps.name);
      if (latest !== null && latest !== lastActioned && isNewer(deps.current, latest)) {
        lastActioned = latest;
        await handleNewVersion({
          globalConfig,
          deps,
          method,
          latest,
          setUpdateStatus,
          emit,
        });
      }
    } catch {
      // Never let an update check take down the worker.
    }
    await sleep(intervalMs, signal);
  }
}

interface HandleNewVersionArgs {
  globalConfig: GlobalConfig;
  deps: UpdateDeps;
  method: Exclude<InstallMethod, "unknown">;
  latest: string;
  setUpdateStatus: (info: UpdateStatus) => void;
  emit?: HeadlessLogEmitter | null | undefined;
}

async function handleNewVersion(args: HandleNewVersionArgs): Promise<void> {
  const { globalConfig, deps, method, latest, setUpdateStatus, emit } = args;
  const from = deps.current;

  if (!globalConfig.autoUpdate) {
    setUpdateStatus({ state: "available", from, to: latest });
    emit?.({
      level: "info",
      event: "update.available",
      fields: { from, to: latest },
    });
    return;
  }

  const result = await deps.install(method, deps.name);
  if (result.ok) {
    setUpdateStatus({ state: "installed", from, to: latest });
    emit?.({
      level: "info",
      event: "update.installed",
      fields: { from, to: latest },
    });
    return;
  }

  setUpdateStatus({ state: "available", from, to: latest, installError: result.output });
  emit?.({
    level: "warn",
    event: "update.available",
    fields: { from, to: latest, installError: result.output },
  });
}
