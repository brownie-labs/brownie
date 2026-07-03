import { defineCommand } from "citty";
import { isConfigured, runConfigure } from "./configure.js";
import { logger } from "./logger.js";
import { startWorker } from "./start.js";

export interface RunBrownieOptions {
  positionals?: string[] | undefined;
  interactive?: boolean | undefined;
}

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

export async function runBrownie(options: RunBrownieOptions = {}): Promise<void> {
  const [positional] = options.positionals ?? [];
  if (positional !== undefined) {
    logger.error(
      `Unknown command "${positional}" — run plain brownie to start the worker or "brownie config" to change the configuration.`,
    );
    process.exitCode = 1;
    return;
  }

  const interactive = options.interactive ?? isInteractiveTerminal();
  const needsConfig = !isConfigured();
  if (needsConfig && interactive) {
    const saved = await runConfigure();
    if (!saved) return;
  }

  await startWorker();
}

export const mainCommand = defineCommand({
  meta: {
    name: "brownie",
    description:
      "Two-agent Claude Code worker: the monitor reports tasks on a cycle, the executor completes them. " +
      "Configures itself on first run, then starts the dashboard.",
  },
  run: ({ args }) =>
    runBrownie({
      positionals: args._,
    }),
});
