import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const BROWNIE_DIR_NAME = ".brownie";

export const FALLBACK_PACKAGE_NAME = "@brownie-labs/brownie";

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

export function controlSocketPath(projectDir: string = process.cwd()): string {
  const hash = createHash("sha256")
    .update(resolve(projectDir))
    .digest("hex")
    .slice(0, 16);
  const uid = process.getuid?.() ?? 0;
  const name = `brownie-${String(uid)}-${hash}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${name}`
    : join(tmpdir(), `${name}.sock`);
}

export const packageRootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export const packagePromptsDir = join(packageRootDir, "prompts");

export const globalBrownieDir = join(homedir(), BROWNIE_DIR_NAME);

export const globalConfigFile = join(globalBrownieDir, "config.json");

const packageManifestSchema = z.object({
  name: z.string().default(FALLBACK_PACKAGE_NAME),
  version: z.string().default("unknown"),
});

function readPackageManifest(): z.infer<typeof packageManifestSchema> {
  try {
    const raw = readFileSync(join(packageRootDir, "package.json"), "utf8");
    return packageManifestSchema.parse(JSON.parse(raw));
  } catch {
    return { name: FALLBACK_PACKAGE_NAME, version: "unknown" };
  }
}

export function packageVersion(): string {
  return readPackageManifest().version;
}

export function packageName(): string {
  return readPackageManifest().name;
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
