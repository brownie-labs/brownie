import { readFile, rename, writeFile } from "node:fs/promises";

export interface ContextFileAccess {
  read(): Promise<string>;
  write(content: string): Promise<void>;
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function createContextFileAccess(path: string): ContextFileAccess {
  return {
    read: async () => {
      try {
        return (await readFile(path, "utf8")).trimEnd();
      } catch (error) {
        if (isMissingFile(error)) return "";
        throw error;
      }
    },
    write: async (content) => {
      const trimmed = content.trimEnd();
      const tmpPath = `${path}.tmp`;
      await writeFile(tmpPath, trimmed === "" ? "" : `${trimmed}\n`, "utf8");
      await rename(tmpPath, path);
    },
  };
}
