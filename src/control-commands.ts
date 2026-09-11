import { defineCommand } from "citty";
import { sendControlRequest } from "./control-client.js";
import {
  CONTROL_TARGETS,
  type ControlAgentStatus,
  type ControlPhase,
  type ControlRequestInput,
  type ControlStatus,
  type ControlSuccess,
  type ControlTarget,
} from "./control-protocol.js";
import { logger } from "./logger.js";
import { CONTROL_SOCKET_ENV, controlSocketPath } from "./paths.js";

export interface ControlCommandIo {
  projectDir?: string | undefined;
  write?: ((line: string) => void) | undefined;
  readStdin?: (() => Promise<string>) | undefined;
}

export const SOCKET_ENV_HINT = `Env: ${CONTROL_SOCKET_ENV} overrides the control socket path.`;

export function writerFor(io: ControlCommandIo): (line: string) => void {
  return (
    io.write ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    })
  );
}

export function fail(message: string): void {
  logger.error(message);
  process.exitCode = 1;
}

export function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) {
    return Promise.reject(new Error("Pass a file path or pipe the content on stdin."));
  }
  return new Promise((resolve, reject) => {
    let content = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      content += chunk;
    });
    process.stdin.once("end", () => {
      resolve(content);
    });
    process.stdin.once("error", reject);
  });
}

export async function requestControl<R extends ControlRequestInput>(
  request: R,
  io: ControlCommandIo,
): Promise<ControlSuccess<R["cmd"]> | null> {
  try {
    const response = await sendControlRequest(controlSocketPath(io.projectDir), request);
    if (!response.ok) {
      fail(response.error);
      return null;
    }
    return response;
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return null;
  }
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
  if (phase.reason !== undefined) parts.push(phase.reason);
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

export async function runStatus(
  options: { json?: boolean | undefined } & ControlCommandIo = {},
): Promise<void> {
  const write = writerFor(options);
  const response = await requestControl({ cmd: "status" }, options);
  if (response === null) return;
  if (options.json === true) {
    write(JSON.stringify(response.data, null, 2));
    return;
  }
  for (const line of renderStatus(response.data)) write(line);
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
    fail(
      `Unknown agent "${agentArg ?? ""}" — use monitor or executor, or omit it for both.`,
    );
    return;
  }
  const response = await requestControl({ cmd: action, agent: target }, options);
  if (response === null) return;
  const label = target === "all" ? "monitor and executor" : target;
  logger.success(action === "pause" ? `Pausing ${label}.` : `Resumed ${label}.`);
}

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: `Show the status of the brownie worker running in this project. ${SOCKET_ENV_HINT}`,
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
