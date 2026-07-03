import { defineCommand, type ArgsDef } from "citty";
import { isConfigured, runConfigure } from "./configure.js";
import { logger } from "./logger.js";
import { startWorker } from "./start.js";

const mainArgs = {
  configure: {
    type: "boolean",
    description: "Rerun the configuration wizard before starting the worker",
  },
} satisfies ArgsDef;

export interface RunBrownieOptions {
  configure?: boolean | undefined;
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
      `Unknown command "${positional}" — run plain brownie, configuration starts automatically on first run (or use --configure).`,
    );
    process.exitCode = 1;
    return;
  }

  const interactive = options.interactive ?? isInteractiveTerminal();
  const needsConfig = !isConfigured();
  if ((options.configure === true || needsConfig) && interactive) {
    const saved = await runConfigure();
    if (!saved && needsConfig) return;
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
  args: mainArgs,
  run: ({ args }) =>
    runBrownie({
      configure: args.configure,
      positionals: args._,
    }),
});
