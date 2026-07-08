import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { SessionEventSink } from "./session-events.js";
import { StreamRenderer } from "./stream.js";
import type { EffortLevel, SessionFailureReason, SessionResult } from "./types.js";

const KILL_GRACE_MS = 5000;

type KillReason = "timeout" | "abort";

export interface SessionSpec {
  command: string;
  model: string;
  effort: EffortLevel;
  systemPrompt: string;
  prompt: string;
  sessionTimeoutMs?: number | undefined;
  streamPartial: boolean;
  mcpConfig?: string | undefined;
  jsonSchema?: string | undefined;
  cwd: string;
  childEnv?: NodeJS.ProcessEnv | undefined;
  events: SessionEventSink;
}

export async function runSession(
  spec: SessionSpec,
  signal: AbortSignal,
): Promise<SessionResult> {
  const startedAt = Date.now();

  const args = [
    "-p",
    "--model",
    spec.model,
    "--effort",
    spec.effort,
    "--system-prompt",
    spec.systemPrompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
  ];
  if (spec.streamPartial) args.push("--include-partial-messages");
  if (spec.mcpConfig) args.push("--mcp-config", spec.mcpConfig);
  if (spec.jsonSchema) args.push("--json-schema", spec.jsonSchema);

  const child = spawn(spec.command, args, {
    cwd: spec.cwd,
    env: spec.childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const renderer = new StreamRenderer(spec.events, spec.streamPartial);

  const killState: { reason: KillReason | null } = { reason: null };
  const kill = (reason: KillReason): void => {
    killState.reason ??= reason;
    killChild(child, reason, spec.events);
  };

  const timeout = spec.sessionTimeoutMs
    ? setTimeout(() => kill("timeout"), spec.sessionTimeoutMs)
    : undefined;
  const onAbort = () => kill("abort");
  signal.addEventListener("abort", onAbort, { once: true });

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => renderer.handleLine(line));

  const stderrRl = createInterface({ input: child.stderr });
  stderrRl.on("line", (line) => {
    if (line.trim()) spec.events({ type: "stderr", line });
  });

  try {
    const spawnError = await new Promise<Error | null>((resolvePromise) => {
      child.once("error", (err) => resolvePromise(err));
      child.once("spawn", () => resolvePromise(null));
    });

    if (spawnError) {
      return {
        ok: false,
        durationMs: Date.now() - startedAt,
        error: `Failed to start "${spec.command}": ${spawnError.message}`,
        failureReason: "spawn",
      };
    }

    child.on("error", (err) =>
      spec.events({ type: "procError", message: `Process error: ${err.message}` }),
    );
    child.stdin.on("error", (err) =>
      spec.events({ type: "procError", message: `stdin: ${err.message}` }),
    );
    child.stdin.write(spec.prompt);
    child.stdin.end();

    const { code, exitSignal } = await new Promise<{
      code: number | null;
      exitSignal: NodeJS.Signals | null;
    }>((resolvePromise) => {
      child.once("close", (exitCode, closeSignal) =>
        resolvePromise({ code: exitCode, exitSignal: closeSignal }),
      );
    });

    const summary = renderer.getSummary();
    const ok = code === 0 && !summary.isError && killState.reason === null;
    const failureReason = ok
      ? undefined
      : classifyFailure(killState.reason, summary.isError);

    return {
      ok,
      durationMs: Date.now() - startedAt,
      costUsd: summary.costUsd,
      numTurns: summary.numTurns,
      sessionId: summary.sessionId,
      resultText: summary.resultText,
      error: ok ? undefined : describeFailure(failureReason, code, exitSignal),
      failureReason,
      rateLimit: summary.rateLimit,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
    rl.close();
    stderrRl.close();
  }
}

function classifyFailure(
  killReason: KillReason | null,
  isError: boolean | undefined,
): SessionFailureReason {
  if (killReason !== null) return killReason;
  if (isError) return "isError";
  return "exit";
}

function describeFailure(
  reason: SessionFailureReason | undefined,
  code: number | null,
  exitSignal: NodeJS.Signals | null,
): string {
  switch (reason) {
    case "timeout":
      return "Session timed out";
    case "abort":
      return "Session aborted";
    case "isError":
      return "Session ended with an error (is_error)";
    default:
      return code !== null
        ? `Process exited with code ${code}`
        : `Process terminated by signal ${exitSignal ?? "?"}`;
  }
}

function killChild(
  child: ChildProcess,
  reason: KillReason,
  events: SessionEventSink,
): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  events({ type: "killing", reason });
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, KILL_GRACE_MS).unref();
}
