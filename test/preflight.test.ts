import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir, removeTempDir } from "./helpers.js";

vi.mock("../src/logger.js", () => ({
  logger: { success: vi.fn(), error: vi.fn() },
  sessionLogger: { warn: vi.fn() },
}));

const { ensureReady } = await import("../src/preflight.js");

describe("ensureReady", () => {
  let dir: string;
  let binDir: string;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await createTempDir();
    binDir = join(dir, "bin");
    savedEnv = { ...process.env };

    await mkdir(binDir, { recursive: true });
    const claude = join(binDir, "claude");
    await writeFile(claude, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(claude, 0o755);

    await mkdir(join(dir, "prompts"), { recursive: true });
    await writeFile(join(dir, "prompts", "prompt.md"), "zadanie\n", "utf8");
    await writeFile(join(dir, "prompts", "system.md"), "system\n", "utf8");
    await writeFile(join(dir, ".env"), "CLAUDE_WORKER_MODEL=haiku\n", "utf8");

    vi.spyOn(process, "cwd").mockReturnValue(dir);
    process.env.PATH = binDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
    await removeTempDir(dir);
  });

  it("przechodzi, gdy wszystko jest na miejscu", async () => {
    await expect(ensureReady()).resolves.toBeUndefined();
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
