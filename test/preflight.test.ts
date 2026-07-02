import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir, removeTempDir, seedWorkerFiles, snapshotEnv } from "./helpers.js";

vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { ensureReady } = await import("../src/preflight.js");

describe("ensureReady", () => {
  let dir: string;
  let binDir: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    dir = await createTempDir();
    binDir = join(dir, "bin");
    restoreEnv = snapshotEnv();

    await mkdir(binDir, { recursive: true });
    const claude = join(binDir, "claude");
    await writeFile(claude, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(claude, 0o755);

    await seedWorkerFiles(dir);

    vi.spyOn(process, "cwd").mockReturnValue(dir);
    process.env.PATH = binDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    restoreEnv();
    await removeTempDir(dir);
  });

  it("przechodzi i zwraca zweryfikowane ścieżki promptów wszystkich agentów", async () => {
    await expect(ensureReady()).resolves.toEqual({
      monitor: {
        promptPath: join(dir, "prompts", "monitor.prompt.md"),
        systemPromptPath: join(dir, "prompts", "monitor.system.md"),
      },
      executor: {
        promptPath: join(dir, "prompts", "executor.prompt.md"),
        systemPromptPath: join(dir, "prompts", "executor.system.md"),
      },
      summarizer: {
        systemPromptPath: join(dir, "prompts", "summarizer.system.md"),
      },
    });
  });

  it("rzuca z podpowiedzią instalacji, gdy brak claude w PATH", async () => {
    process.env.PATH = join(dir, "puste");
    await expect(ensureReady()).rejects.toThrow(/Preflight nieudany[\s\S]*PATH/);
  });

  it("rzuca z podpowiedzią configure, gdy brak pliku promptu", async () => {
    await removeTempDir(join(dir, "prompts"));
    await expect(ensureReady()).rejects.toThrow(/pnpm configure/);
  });

  it("rzuca, gdy brak pliku .env", async () => {
    await removeTempDir(join(dir, ".env"));
    await expect(ensureReady()).rejects.toThrow(/Preflight nieudany/);
  });
});
