import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectPaths } from "../src/paths.js";
import { createTempDir, removeTempDir, seedProject } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  runConfigure: vi.fn(),
}));

vi.mock("../src/configure.js", () => ({ runConfigure: mocks.runConfigure }));
vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { initCommand, runInit } = await import("../src/init-command.js");
const { logger } = await import("../src/logger.js");

describe("runInit", () => {
  let dir: string;
  let monitorSource: string;
  let executorSource: string;
  let savedExitCode: typeof process.exitCode;

  beforeEach(async () => {
    vi.clearAllMocks();
    savedExitCode = process.exitCode;
    dir = await createTempDir();
    monitorSource = join(dir, "monitor-source.md");
    executorSource = join(dir, "executor-source.md");
    await writeFile(monitorSource, "watch GitHub issues\n", "utf8");
    await writeFile(executorSource, "# Role\nBe diligent\n", "utf8");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
    await removeTempDir(dir);
  });

  it("scaffolds the project from prompt files without a TTY", async () => {
    const paths = projectPaths(dir);

    await runInit({
      monitorPromptPath: monitorSource,
      executorPromptPath: executorSource,
      projectDir: dir,
      interactive: false,
    });

    expect(process.exitCode).toBe(savedExitCode);
    expect(await readFile(paths.settingsFile, "utf8")).toBe("{}\n");
    expect(await readFile(paths.monitorPromptFile, "utf8")).toBe("watch GitHub issues\n");
    expect(await readFile(paths.executorPromptFile, "utf8")).toBe(
      "# Role\nBe diligent\n",
    );
    expect(await readFile(paths.gitignoreFile, "utf8")).toBe("data/\nlogs/\n");
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining("settings.json"));
  });

  it("keeps an existing settings.json and skips its saved message", async () => {
    await seedProject(dir, { settings: '{"streamPartial": false}\n' });
    const paths = projectPaths(dir);

    await runInit({
      monitorPromptPath: monitorSource,
      executorPromptPath: executorSource,
      projectDir: dir,
      force: true,
      interactive: false,
    });

    expect(await readFile(paths.settingsFile, "utf8")).toBe('{"streamPartial": false}\n');
    expect(logger.success).not.toHaveBeenCalledWith(
      expect.stringContaining("settings.json"),
    );
  });

  it("refuses to overwrite existing prompts without --force", async () => {
    await seedProject(dir, { monitorPrompt: "existing\n" });
    const paths = projectPaths(dir);

    await runInit({
      monitorPromptPath: monitorSource,
      executorPromptPath: executorSource,
      projectDir: dir,
      interactive: false,
    });

    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("--force"));
    expect(await readFile(paths.monitorPromptFile, "utf8")).toBe("existing\n");
  });

  it("overwrites existing prompts with --force", async () => {
    await seedProject(dir);
    const paths = projectPaths(dir);

    await runInit({
      monitorPromptPath: monitorSource,
      executorPromptPath: executorSource,
      projectDir: dir,
      force: true,
      interactive: false,
    });

    expect(process.exitCode).toBe(savedExitCode);
    expect(await readFile(paths.monitorPromptFile, "utf8")).toBe("watch GitHub issues\n");
  });

  it("requires both prompt flags together", async () => {
    await runInit({
      monitorPromptPath: monitorSource,
      projectDir: dir,
      interactive: false,
    });

    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("required together"),
    );
    expect(existsSync(projectPaths(dir).settingsFile)).toBe(false);
  });

  it("fails without flags when there is no TTY", async () => {
    await runInit({ projectDir: dir, interactive: false });

    expect(process.exitCode).toBe(1);
    expect(mocks.runConfigure).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("--monitor-prompt"),
    );
  });

  it("delegates to the wizard without flags in a terminal", async () => {
    mocks.runConfigure.mockResolvedValue(true);

    await runInit({ projectDir: dir, interactive: true });

    expect(process.exitCode).toBe(savedExitCode);
    expect(mocks.runConfigure).toHaveBeenCalledWith(dir);
  });

  it("fails when a prompt file cannot be read", async () => {
    await runInit({
      monitorPromptPath: join(dir, "missing.md"),
      executorPromptPath: executorSource,
      projectDir: dir,
      interactive: false,
    });

    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("missing.md"));
    expect(existsSync(projectPaths(dir).settingsFile)).toBe(false);
  });

  it("forwards CLI args from the citty command", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    await (initCommand.run as (ctx: unknown) => Promise<void>)({
      args: {
        "monitor-prompt": monitorSource,
        "executor-prompt": executorSource,
        force: false,
        _: [],
      },
    });

    expect(await readFile(projectPaths(dir).settingsFile, "utf8")).toBe("{}\n");
  });

  it("fails when a prompt file is empty", async () => {
    await writeFile(monitorSource, "\n  \n", "utf8");

    await runInit({
      monitorPromptPath: monitorSource,
      executorPromptPath: executorSource,
      projectDir: dir,
      interactive: false,
    });

    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("is empty"));
  });
});
