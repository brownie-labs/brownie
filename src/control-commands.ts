import { defineCommand } from "citty";
import { sendControlRequest, WorkerNotRunningError } from "./control-client.js";
import {
  CONTROL_TARGETS,
  type ControlAgentStatus,
  type ControlPhase,
  type ControlStatus,
  type ControlTarget,
} from "./control-protocol.js";
import { logger } from "./logger.js";
import { controlSocketPath } from "./paths.js";

export interface ControlCommandIo {
  projectDir?: string | undefined;
  write?: ((line: string) => void) | undefined;
}

function formatUptime(startedAt: string): string {
  const elapsedMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  if (totalMinutes > 0) return `${String(minutes)}m`;
  return `${String(Math.floor(elapsedMs / 1000))}s`;
}

function describePhase(phase: ControlPhase): string {
  const parts = [phase.kind];
  if (phase.cycle !== undefined) parts.push(`cycle ${String(phase.cycle)}`);
  if (phase.taskId !== undefined) parts.push(phase.taskId);
  if (phase.until !== undefined) {
    parts.push(`until ${new Date(phase.until).toLocaleTimeString()}`);
  }
  return parts.join(" · ");
}

function agentLine(name: string, agent: ControlAgentStatus<{ ok: boolean }>): string {
  return `${name.padEnd(9)} ${agent.control.padEnd(8)} ${describePhase(agent.phase)}`;
}

function renderStatus(status: ControlStatus): string[] {
  const { stats, taskCounts } = status;
  const mode = status.headless ? "headless" : "interactive";
  return [
    `brownie ${status.version} · pid ${String(status.pid)} · up ${formatUptime(status.startedAt)} · ${mode}`,
    `project   ${status.projectDir}`,
    agentLine("monitor", status.agents.monitor),
    agentLine("executor", status.agents.executor),
    `tasks     pending ${String(taskCounts.pending)} · in_progress ${String(taskCounts.in_progress)} · done ${String(taskCounts.done)} · failed ${String(taskCounts.failed)} · cancelled ${String(taskCounts.cancelled)}`,
    `stats     cycles ${String(stats.cycles)} · tasks ok ${String(stats.tasksSucceeded)} · tasks failed ${String(stats.tasksFailed)} · cost $${stats.totalCostUsd.toFixed(4)}`,
  ];
}

function reportFailure(error: unknown): void {
  if (error instanceof WorkerNotRunningError) {
    logger.error(error.message);
  } else {
    logger.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

export async function runStatus(
  options: { json?: boolean | undefined } & ControlCommandIo = {},
): Promise<void> {
  const write =
    options.write ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  let status: ControlStatus;
  try {
    const response = await sendControlRequest(controlSocketPath(options.projectDir), {
      cmd: "status",
    });
    if (!response.ok || response.data === undefined) {
      logger.error(response.error ?? "The worker returned an invalid status.");
      process.exitCode = 1;
      return;
    }
    status = response.data;
  } catch (err) {
    reportFailure(err);
    return;
  }
  if (options.json === true) {
    write(JSON.stringify(status, null, 2));
    return;
  }
  for (const line of renderStatus(status)) write(line);
}

function parseTarget(value: string | undefined): ControlTarget | null {
  if (value === undefined) return "all";
  return (CONTROL_TARGETS as readonly string[]).includes(value) && value !== "all"
    ? (value as ControlTarget)
    : null;
}

export async function runControlAction(
  action: "pause" | "resume",
  agentArg: string | undefined,
  options: ControlCommandIo = {},
): Promise<void> {
  const target = parseTarget(agentArg);
  if (target === null) {
    logger.error(
      `Unknown agent "${agentArg ?? ""}" — use monitor or executor, or omit it for both.`,
    );
    process.exitCode = 1;
    return;
  }
  try {
    const response = await sendControlRequest(controlSocketPath(options.projectDir), {
      cmd: action,
      agent: target,
    });
    if (!response.ok) {
      logger.error(response.error ?? "The worker rejected the request.");
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    reportFailure(err);
    return;
  }
  const label = target === "all" ? "monitor and executor" : target;
  logger.success(action === "pause" ? `Pausing ${label}.` : `Resumed ${label}.`);
}

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show the status of the brownie worker running in this project.",
  },
  args: {
    json: { type: "boolean", description: "Print the raw status as JSON" },
  },
  run: ({ args }) => runStatus({ json: args.json }),
});

export const pauseCommand = defineCommand({
  meta: {
    name: "pause",
    description: "Pause the running worker's agents (they finish their session first).",
  },
  args: {
    agent: {
      type: "positional",
      required: false,
      description: "monitor or executor (default: both)",
    },
  },
  run: ({ args }) => runControlAction("pause", args.agent),
});

export const resumeCommand = defineCommand({
  meta: {
    name: "resume",
    description: "Resume the running worker's paused agents.",
  },
  args: {
    agent: {
      type: "positional",
      required: false,
      description: "monitor or executor (default: both)",
    },
  },
  run: ({ args }) => runControlAction("resume", args.agent),
});
