import { readFile, rename, writeFile } from "node:fs/promises";

export const PROMPT_AGENTS = ["monitor", "executor"] as const;

export type PromptAgent = (typeof PROMPT_AGENTS)[number];

export interface PromptFileAccess {
  read(agent: PromptAgent): Promise<string>;
  write(agent: PromptAgent, content: string): Promise<void>;
}

export type PromptFilePaths = Record<PromptAgent, string>;

export function createPromptFileAccess(paths: PromptFilePaths): PromptFileAccess {
  return {
    read: async (agent) => (await readFile(paths[agent], "utf8")).trimEnd(),
    write: async (agent, content) => {
      const path = paths[agent];
      const tmpPath = `${path}.tmp`;
      await writeFile(tmpPath, `${content.trimEnd()}\n`, "utf8");
      await rename(tmpPath, path);
    },
  };
}
