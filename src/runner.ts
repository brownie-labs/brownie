import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { sessionLogger } from "./logger.js";
import { StreamRenderer } from "./stream.js";
import type { SessionResult, WorkerConfig } from "./types.js";

const KILL_GRACE_MS = 5000;

type KillReason = "timeout" | "abort";

export async function runSession(
  config: WorkerConfig,
  signal: AbortSignal,
): Promise<SessionResult> {
  const startedAt = Date.now();

  const [prompt, systemPrompt] = await Promise.all([
    readFile(config.promptPath, "utf8"),
    readFile(config.systemPromptPath, "utf8"),
  ]);

  const args = [
    "-p",
    "--model",
    config.model,
    "--system-prompt",
    systemPrompt,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (config.permissionMode) args.push("--permission-mode", config.permissionMode);
  if (config.streamPartial) args.push("--include-partial-messages");

  const child = spawn(config.command, args, {
    cwd: config.cwd,
    env: config.childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const renderer = new StreamRenderer(sessionLogger, config.streamPartial);

  const killState: { reason: KillReason | null } = { reason: null };
  const kill = (reason: KillReason): void => {
    killState.reason ??= reason;
    killChild(child, reason);
  };

  const timeout = config.sessionTimeoutMs
    ? setTimeout(() => kill("timeout"), config.sessionTimeoutMs)
    : undefined;
  const onAbort = () => kill("abort");
  signal.addEventListener("abort", onAbort, { once: true });

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => renderer.handleLine(line));

  const stderrRl = createInterface({ input: child.stderr });
  stderrRl.on("line", (line) => {
    if (line.trim()) sessionLogger.debug(`stderr: ${line}`);
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
        error: `Nie udało się uruchomić "${config.command}": ${spawnError.message}`,
      };
    }

    child.on("error", (err) => sessionLogger.error(`Błąd procesu: ${err.message}`));
    child.stdin.on("error", (err) => sessionLogger.debug(`stdin: ${err.message}`));
    child.stdin.write(prompt);
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

function killChild(child: ChildProcess, reason: KillReason): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  sessionLogger.warn(`Zatrzymuję sesję (${reason})…`);
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, KILL_GRACE_MS).unref();
}
