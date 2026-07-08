import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { runConfigure } from "./configure.js";
import { logger } from "./logger.js";
import { projectPaths } from "./paths.js";
import { writeProjectScaffold } from "./scaffold.js";

export interface InitOptions {
  monitorPromptPath?: string | undefined;
  executorPromptPath?: string | undefined;
  force?: boolean | undefined;
  projectDir?: string | undefined;
  interactive?: boolean | undefined;
}

async function readPromptFile(path: string, label: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    logger.error(
      `Cannot read ${label} file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  const content = raw.trimEnd();
  if (content === "") {
    logger.error(`The ${label} file ${path} is empty.`);
    return null;
  }
  return content;
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const { monitorPromptPath, executorPromptPath } = options;
  const interactive =
    options.interactive ?? (process.stdin.isTTY && process.stdout.isTTY);

  if (monitorPromptPath === undefined && executorPromptPath === undefined) {
    if (!interactive) {
      logger.error(
        "No prompt files given — pass --monitor-prompt and --executor-prompt, " +
          "or run brownie init in an interactive terminal to use the wizard.",
      );
      process.exitCode = 1;
      return;
    }
    await runConfigure(options.projectDir);
    return;
  }

  if (monitorPromptPath === undefined || executorPromptPath === undefined) {
    logger.error("Both --monitor-prompt and --executor-prompt are required together.");
    process.exitCode = 1;
    return;
  }

  const paths = projectPaths(options.projectDir);

  if (options.force !== true) {
    const existing = [paths.monitorPromptFile, paths.executorPromptFile].filter((path) =>
      existsSync(path),
    );
    if (existing.length > 0) {
      const details = existing.map((path) => `  - ${path}`).join("\n");
      logger.error(`Refusing to overwrite existing files (use --force):\n${details}`);
      process.exitCode = 1;
      return;
    }
  }

  const [monitorPrompt, executorPrompt] = await Promise.all([
    readPromptFile(monitorPromptPath, "monitor prompt"),
    readPromptFile(executorPromptPath, "executor prompt"),
  ]);
  if (monitorPrompt === null || executorPrompt === null) {
    process.exitCode = 1;
    return;
  }

  const { createdSettings } = await writeProjectScaffold(paths, {
    monitorPrompt,
    executorPrompt,
  });

  if (createdSettings) logger.success(`Saved ${paths.settingsFile}`);
  logger.success(`Saved ${paths.monitorPromptFile}`);
  logger.success(`Saved ${paths.executorPromptFile}`);
  logger.info("Run brownie in the project directory to start the worker.");
}

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description:
      "Set up .brownie/ for the current project — non-interactive with " +
      "--monitor-prompt/--executor-prompt, or via the wizard in a terminal.",
  },
  args: {
    "monitor-prompt": {
      type: "string",
      description: "Path to a markdown file with the monitor prompt",
    },
    "executor-prompt": {
      type: "string",
      description: "Path to a markdown file with the executor prompt",
    },
    force: {
      type: "boolean",
      description: "Overwrite existing prompt files",
    },
  },
  run: ({ args }) =>
    runInit({
      monitorPromptPath: args["monitor-prompt"],
      executorPromptPath: args["executor-prompt"],
      force: args.force,
    }),
});
