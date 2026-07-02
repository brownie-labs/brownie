import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { ConsolaInstance } from "consola";
import { StreamRenderer } from "./stream.js";
import type { SessionResult } from "./types.js";

const KILL_GRACE_MS = 5000;

type KillReason = "timeout" | "abort";

export interface SessionSpec {
  command: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  sessionTimeoutMs?: number | undefined;
  streamPartial: boolean;
  cwd: string;
  childEnv: NodeJS.ProcessEnv;
  log: ConsolaInstance;
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
    "--system-prompt",
    spec.systemPrompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
  ];
  if (spec.streamPartial) args.push("--include-partial-messages");

  const child = spawn(spec.command, args, {
    cwd: spec.cwd,
    env: spec.childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const renderer = new StreamRenderer(spec.log, spec.streamPartial);

  const killState: { reason: KillReason | null } = { reason: null };
  const kill = (reason: KillReason): void => {
    killState.reason ??= reason;
    killChild(child, reason, spec.log);
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
    if (line.trim()) spec.log.debug(`stderr: ${line}`);
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
        error: `Nie udało się uruchomić "${spec.command}": ${spawnError.message}`,
      };
    }

    child.on("error", (err) => spec.log.error(`Błąd procesu: ${err.message}`));
    child.stdin.on("error", (err) => spec.log.debug(`stdin: ${err.message}`));
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

    return {
      ok,
      durationMs: Date.now() - startedAt,
      costUsd: summary.costUsd,
      numTurns: summary.numTurns,
      sessionId: summary.sessionId,
      resultText: summary.resultText,
      error: ok
        ? undefined
        : describeFailure(killState.reason, summary.isError, code, exitSignal),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
    rl.close();
    stderrRl.close();
  }
}

function describeFailure(
  killReason: KillReason | null,
  isError: boolean | undefined,
  code: number | null,
  exitSignal: NodeJS.Signals | null,
): string {
  if (killReason === "timeout") return "Przekroczono limit czasu sesji";
  if (killReason === "abort") return "Sesja przerwana";
  if (isError) return "Sesja zakończona błędem (is_error)";
  if (code !== null) return `Proces zakończył się kodem ${code}`;
  return `Proces zakończony sygnałem ${exitSignal ?? "?"}`;
}

function killChild(child: ChildProcess, reason: KillReason, log: ConsolaInstance): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  log.warn(`Zatrzymuję sesję (${reason})…`);
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, KILL_GRACE_MS).unref();
}
