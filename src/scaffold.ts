import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import type { ProjectPaths } from "./paths.js";

const BROWNIE_GITIGNORE = "data/\nlogs/\n";

export interface ProjectPrompts {
  monitorPrompt: string;
  executorPrompt: string;
}

export interface ScaffoldResult {
  createdSettings: boolean;
}

export async function writeProjectScaffold(
  paths: ProjectPaths,
  prompts: ProjectPrompts,
): Promise<ScaffoldResult> {
  await mkdir(paths.promptsDir, { recursive: true });
  const createdSettings = !existsSync(paths.settingsFile);
  if (createdSettings) {
    await writeFile(paths.settingsFile, "{}\n", "utf8");
  }
  await writeFile(paths.monitorPromptFile, `${prompts.monitorPrompt}\n`, "utf8");
  await writeFile(paths.executorPromptFile, `${prompts.executorPrompt}\n`, "utf8");
  if (!existsSync(paths.gitignoreFile)) {
    await writeFile(paths.gitignoreFile, BROWNIE_GITIGNORE, "utf8");
  }
  return { createdSettings };
}
