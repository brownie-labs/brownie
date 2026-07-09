import { spawn } from "node:child_process";
import { packageRootDir } from "../paths.js";

export type InstallMethod = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

const KILL_GRACE_MS = 5_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 120_000;

export function detectInstallMethod(rootDir: string = packageRootDir): InstallMethod {
  const normalized = rootDir.replaceAll("\\", "/").toLowerCase();
  if (!normalized.includes("/node_modules/") && !normalized.endsWith("/node_modules")) {
    return "unknown";
  }
  if (normalized.includes("/pnpm/") || normalized.includes("/.pnpm/")) return "pnpm";
  if (normalized.includes("/yarn/") || normalized.includes("/.yarn/")) return "yarn";
  if (normalized.includes("/.bun/") || normalized.includes("/bun/")) return "bun";
  return "npm";
}

export function installCommand(
  method: Exclude<InstallMethod, "unknown">,
  name: string,
): { command: string; args: string[] } {
  const target = `${name}@latest`;
  switch (method) {
    case "npm":
      return { command: "npm", args: ["install", "-g", target] };
    case "pnpm":
      return { command: "pnpm", args: ["add", "-g", target] };
    case "yarn":
      return { command: "yarn", args: ["global", "add", target] };
    case "bun":
      return { command: "bun", args: ["add", "-g", target] };
  }
}

export interface RunInstallOptions {
  env?: NodeJS.ProcessEnv | undefined;
  timeoutMs?: number | undefined;
}

export interface InstallResult {
  ok: boolean;
  output: string;
}

export function runInstall(
  method: Exclude<InstallMethod, "unknown">,
  name: string,
  options: RunInstallOptions = {},
): Promise<InstallResult> {
  const { command, args } = installCommand(method, name);
  const { env = process.env, timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS } = options;

  return new Promise<InstallResult>((resolvePromise) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: string[] = [];
    let settled = false;

    const settle = (result: InstallResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };

    const timer = setTimeout(() => {
      chunks.push(`\nInstall timed out after ${String(timeoutMs)}ms`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    child.on("error", (err) => {
      chunks.push(`Failed to start "${command}": ${err.message}`);
      settle({ ok: false, output: chunks.join("").trim() });
    });
    child.on("close", (code) => {
      settle({ ok: code === 0, output: chunks.join("").trim() });
    });
  });
}
