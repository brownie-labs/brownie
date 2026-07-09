import { defineCommand } from "citty";
import { isConfigured, runConfigure } from "./configure.js";
import { parseHeadlessLogFormat } from "./headless/format.js";
import { logger } from "./logger.js";
import { packageVersion } from "./paths.js";
import { startWorker } from "./start.js";

export interface RunBrownieOptions {
  positionals?: string[] | undefined;
  interactive?: boolean | undefined;
  headless?: boolean | undefined;
  logFormat?: string | undefined;
  verbose?: boolean | undefined;
}

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

export async function runBrownie(options: RunBrownieOptions = {}): Promise<void> {
  const [positional] = options.positionals ?? [];
  if (positional !== undefined) {
    logger.error(
      `Unknown command "${positional}" — available commands: init, status, pause, ` +
        "resume, update, mcp; run plain brownie to start the worker.",
    );
    process.exitCode = 1;
    return;
  }

  const rawLogFormat = options.logFormat ?? process.env.BROWNIE_LOG_FORMAT;
  const logFormat =
    rawLogFormat === undefined ? "pretty" : parseHeadlessLogFormat(rawLogFormat);
  if (logFormat === null) {
    logger.error(`Invalid log format "${rawLogFormat ?? ""}" — use pretty or json.`);
    process.exitCode = 1;
    return;
  }

  const headless = options.headless === true;
  const interactive = options.interactive ?? isInteractiveTerminal();
  const needsConfig = !isConfigured();
  if (needsConfig && interactive && !headless) {
    const saved = await runConfigure();
    if (!saved) return;
  }

  await startWorker({ headless, logFormat, verbose: options.verbose });
}

export const mainCommand = defineCommand({
  meta: {
    name: "brownie",
    version: packageVersion(),
    description:
      "Two-agent Claude Code worker: the monitor reports tasks on a cycle, the executor completes them. " +
      "Configures itself on first run, then starts the dashboard.",
  },
  args: {
    headless: {
      type: "boolean",
      description: "Run without the dashboard and print line logs to stdout",
    },
    "log-format": {
      type: "string",
      description: "Headless log format: pretty or json (env: BROWNIE_LOG_FORMAT)",
    },
    verbose: {
      type: "boolean",
      description: "Include session text and tool calls in headless logs",
    },
  },
  run: ({ args }) =>
    runBrownie({
      positionals: args._,
      headless: args.headless,
      logFormat: args["log-format"],
      verbose: args.verbose,
    }),
});
