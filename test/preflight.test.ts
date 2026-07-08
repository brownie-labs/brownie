import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTempDir,
  removeTempDir,
  seedProject,
  seedSystemPrompts,
  snapshotEnv,
} from "./helpers.js";

vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { ensureReady } = await import("../src/preflight.js");

describe("ensureReady", () => {
  let dir: string;
  let binDir: string;
  let systemPromptsDir: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    dir = await createTempDir();
    binDir = join(dir, "bin");
    restoreEnv = snapshotEnv();

    await mkdir(binDir, { recursive: true });
    const claude = join(binDir, "claude");
    await writeFile(claude, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(claude, 0o755);

    await seedProject(dir);
    systemPromptsDir = await seedSystemPrompts(dir);

    process.env.PATH = binDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    restoreEnv();
    await removeTempDir(dir);
  });

  function dirs() {
    return { projectDir: dir, systemPromptsDir };
  }

  it("passes and returns verified prompt paths for all agents", async () => {
    await expect(ensureReady(dirs())).resolves.toEqual({
      monitor: {
        promptPath: join(dir, ".brownie", "prompts", "monitor.prompt.md"),
        systemPromptPath: join(systemPromptsDir, "monitor.system.md"),
      },
      executor: {
        promptPath: join(dir, ".brownie", "prompts", "executor.prompt.md"),
        systemPromptPath: join(systemPromptsDir, "executor.system.md"),
      },
      summarizer: {
        systemPromptPath: join(systemPromptsDir, "summarizer.system.md"),
      },
    });
  });

  it("throws with an install hint when claude is missing from PATH", async () => {
    process.env.PATH = join(dir, "empty");
    await expect(ensureReady(dirs())).rejects.toThrow(/Preflight failed[\s\S]*PATH/);
  });

  it("throws with a configure hint when a prompt file is missing", async () => {
    await removeTempDir(join(dir, ".brownie", "prompts"));
    await expect(ensureReady(dirs())).rejects.toThrow(/interactive terminal/);
  });

  it("throws when the settings file is missing", async () => {
    await removeTempDir(join(dir, ".brownie", "settings.json"));
    await expect(ensureReady(dirs())).rejects.toThrow(
      /Preflight failed[\s\S]*interactive terminal/,
    );
  });
});
