import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { sessionLogger } from "./logger.js";
import { StreamRenderer } from "./stream.js";
import type { SessionResult, WorkerConfig } from "./types.js";

const KILL_GRACE_MS = 5000;

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

  const timeout = config.sessionTimeoutMs
    ? setTimeout(() => killChild(child, "timeout"), config.sessionTimeoutMs)
    : undefined;
  const onAbort = () => killChild(child, "abort");
  signal.addEventListener("abort", onAbort, { once: true });

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => renderer.handleLine(line));

  const stderrRl = createInterface({ input: child.stderr });
  stderrRl.on("line", (line) => {
    if (line.trim()) sessionLogger.warn(`stderr: ${line}`);
  });

  child.stdin.write(prompt);
  child.stdin.end();

  const spawnError = await new Promise<Error | null>((resolvePromise) => {
    child.once("error", (err) => resolvePromise(err));
    child.once("spawn", () => resolvePromise(null));
  });

  if (spawnError) {
    cleanup();
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: `Nie udało się uruchomić "${config.command}": ${spawnError.message}`,
    };
  }

  const code = await new Promise<number | null>((resolvePromise) => {
    child.once("close", (exitCode) => resolvePromise(exitCode));
  });

  cleanup();

  const summary = renderer.getSummary();
  const durationMs = Date.now() - startedAt;
  const ok = code === 0 && !summary.is_error;

  return {
    ok,
    durationMs,
    costUsd: summary.costUsd,
    numTurns: summary.numTurns,
    sessionId: summary.sessionId,
    error: ok
      ? undefined
      : summary.is_error
        ? "Sesja zakończona błędem (is_error)"
        : `Proces zakończył się kodem ${code}`,
  };

  function cleanup(): void {
    if (timeout) clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
    rl.close();
    stderrRl.close();
  }
}

function killChild(child: ReturnType<typeof spawn>, reason: string): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  sessionLogger.warn(`Zatrzymuję sesję (${reason})…`);
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, KILL_GRACE_MS).unref();
}
