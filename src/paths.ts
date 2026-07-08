import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const BROWNIE_DIR_NAME = ".brownie";

export interface ProjectPaths {
  projectDir: string;
  brownieDir: string;
  settingsFile: string;
  promptsDir: string;
  monitorPromptFile: string;
  executorPromptFile: string;
  dataDir: string;
  tasksFile: string;
  memoryDbFile: string;
  logsDir: string;
  gitignoreFile: string;
}

export function projectPaths(projectDir: string = process.cwd()): ProjectPaths {
  const brownieDir = join(projectDir, BROWNIE_DIR_NAME);
  const promptsDir = join(brownieDir, "prompts");
  const dataDir = join(brownieDir, "data");
  return {
    projectDir,
    brownieDir,
    settingsFile: join(brownieDir, "settings.json"),
    promptsDir,
    monitorPromptFile: join(promptsDir, "monitor.prompt.md"),
    executorPromptFile: join(promptsDir, "executor.prompt.md"),
    dataDir,
    tasksFile: join(dataDir, "tasks.json"),
    memoryDbFile: join(dataDir, "memory.db"),
    logsDir: join(brownieDir, "logs"),
    gitignoreFile: join(brownieDir, ".gitignore"),
  };
}

export const packageRootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export const packagePromptsDir = join(packageRootDir, "prompts");

const packageManifestSchema = z.object({ version: z.string() });

export function packageVersion(): string {
  try {
    const raw = readFileSync(join(packageRootDir, "package.json"), "utf8");
    return packageManifestSchema.parse(JSON.parse(raw)).version;
  } catch {
    return "unknown";
  }
}

export interface SystemPromptFiles {
  monitor: string;
  executor: string;
  summarizer: string;
}

export function systemPromptFiles(dir: string = packagePromptsDir): SystemPromptFiles {
  return {
    monitor: join(dir, "monitor.system.md"),
    executor: join(dir, "executor.system.md"),
    summarizer: join(dir, "summarizer.system.md"),
  };
}
