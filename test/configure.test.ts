import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consola } from "consola";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir, removeTempDir } from "./helpers.js";

vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { isConfigured, runConfigure } = await import("../src/configure.js");

function queueAnswers(...answers: unknown[]): void {
  const prompt = vi.spyOn(consola, "prompt");
  for (const answer of answers) prompt.mockResolvedValueOnce(answer as never);
}

describe("runConfigure", () => {
  let dir: string;
  let envPath: string;
  let monitorPromptPath: string;
  let executorPromptPath: string;

  beforeEach(async () => {
    dir = await createTempDir();
    envPath = join(dir, ".env");
    monitorPromptPath = join(dir, "prompts", "monitor.prompt.md");
    executorPromptPath = join(dir, "prompts", "executor.prompt.md");
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await removeTempDir(dir);
  });

  it("writes .env and both agents' prompts without CLAUDE_CONFIG_DIR", async () => {
    queueAnswers(
      "haiku",
      "medium",
      "15",
      "",
      [],
      "watch Redmine",
      "opus",
      "high",
      "execute diligently",
      false,
    );
    await expect(runConfigure()).resolves.toBe(true);

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_MODEL=haiku");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_EFFORT=medium");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_INTERVAL_MS=900000");
    expect(env).toContain("CLAUDE_WORKER_EXECUTOR_MODEL=opus");
    expect(env).toContain("CLAUDE_WORKER_EXECUTOR_EFFORT=high");
    expect(env).not.toContain("CLAUDE_CONFIG_DIR");
    expect(env).not.toContain("CLAUDE_WORKER_MONITOR_ACTIVE_HOURS");
    expect(env).not.toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS");
    expect(await readFile(monitorPromptPath, "utf8")).toBe("watch Redmine\n");
    expect(await readFile(executorPromptPath, "utf8")).toBe("execute diligently\n");
  });

  it("writes the monitor's working hours and selected days", async () => {
    queueAnswers(
      "haiku",
      "medium",
      "15",
      "08:00-18:00",
      ["mon", "tue", "wed", "thu", "fri"],
      "watch",
      "opus",
      "high",
      "execute",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_ACTIVE_HOURS=08:00-18:00");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS=mon,tue,wed,thu,fri");
  });

  it("normalizes the order of selected days", async () => {
    queueAnswers(
      "haiku",
      "medium",
      "15",
      "",
      ["fri", "mon", "wed"],
      "watch",
      "opus",
      "high",
      "execute",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS=mon,wed,fri");
  });

  it("omits days when all are selected", async () => {
    queueAnswers(
      "haiku",
      "medium",
      "15",
      "",
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      "watch",
      "opus",
      "high",
      "execute",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).not.toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS");
  });

  it("re-asks the working hours question on an invalid format", async () => {
    queueAnswers(
      "haiku",
      "medium",
      "15",
      "bad value",
      "08:00-18:00",
      [],
      "watch",
      "opus",
      "high",
      "execute",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_ACTIVE_HOURS=08:00-18:00");
    expect(env).not.toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS");
  });

  it("appends CLAUDE_CONFIG_DIR when selected", async () => {
    queueAnswers(
      "haiku",
      "medium",
      "2",
      "",
      [],
      "watch",
      "sonnet",
      "high",
      "execute",
      true,
      "~/claude-profile",
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_CONFIG_DIR=~/claude-profile");
    expect(env).toContain("CLAUDE_WORKER_EXECUTOR_MODEL=sonnet");
  });

  it("re-asks the interval question on an invalid value", async () => {
    queueAnswers(
      "haiku",
      "medium",
      "0",
      "abc",
      "3",
      "",
      [],
      "watch",
      "opus",
      "high",
      "execute",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_INTERVAL_MS=180000");
  });

  it("handles a decimal comma in the interval", async () => {
    queueAnswers(
      "haiku",
      "medium",
      "1,5",
      "",
      [],
      "watch",
      "opus",
      "high",
      "execute",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_INTERVAL_MS=90000");
  });

  it("treats empty text and multiselect answers (undefined from consola) as defaults", async () => {
    queueAnswers(
      "haiku",
      "medium",
      "15",
      undefined,
      undefined,
      undefined,
      "opus",
      "high",
      undefined,
      false,
    );

    await expect(runConfigure()).resolves.toBe(true);

    const env = await readFile(envPath, "utf8");
    expect(env).not.toContain("CLAUDE_WORKER_MONITOR_ACTIVE_HOURS");
    expect(env).not.toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS");
    expect(await readFile(monitorPromptPath, "utf8")).toBe("\n");
    expect(await readFile(executorPromptPath, "utf8")).toBe("\n");
  });

  it("cancelling writes no files", async () => {
    const cancelled = new Error("cancelled");
    cancelled.name = "ConsolaPromptCancelledError";
    vi.spyOn(consola, "prompt").mockRejectedValueOnce(cancelled);

    await expect(runConfigure()).resolves.toBe(false);
    expect(existsSync(envPath)).toBe(false);
    expect(existsSync(monitorPromptPath)).toBe(false);
    expect(existsSync(executorPromptPath)).toBe(false);
  });

  it("declining to overwrite existing files finishes without changes", async () => {
    await writeFile(envPath, "OLD=1\n", "utf8");
    vi.spyOn(consola, "prompt").mockResolvedValueOnce(false);

    await expect(runConfigure()).resolves.toBe(false);

    expect(await readFile(envPath, "utf8")).toBe("OLD=1\n");
    expect(existsSync(monitorPromptPath)).toBe(false);
  });

  it("writes .env at the path given via envFile", async () => {
    const customEnvPath = join(dir, "custom.env");
    queueAnswers(
      "haiku",
      "medium",
      "15",
      "",
      [],
      "watch",
      "opus",
      "high",
      "execute",
      false,
    );

    await expect(runConfigure(customEnvPath)).resolves.toBe(true);

    expect(existsSync(customEnvPath)).toBe(true);
    expect(existsSync(envPath)).toBe(false);
  });
});

describe("isConfigured", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await removeTempDir(dir);
  });

  async function seedAll(): Promise<void> {
    await mkdir(join(dir, "prompts"), { recursive: true });
    await writeFile(join(dir, ".env"), "X=1\n", "utf8");
    await writeFile(join(dir, "prompts", "monitor.prompt.md"), "watch\n", "utf8");
    await writeFile(join(dir, "prompts", "executor.prompt.md"), "execute\n", "utf8");
  }

  it("returns true when .env and both prompt files exist", async () => {
    await seedAll();
    expect(isConfigured()).toBe(true);
  });

  it("returns false when .env is missing", async () => {
    await seedAll();
    await rm(join(dir, ".env"));
    expect(isConfigured()).toBe(false);
  });

  it("returns false when a prompt file is missing", async () => {
    await seedAll();
    await rm(join(dir, "prompts", "executor.prompt.md"));
    expect(isConfigured()).toBe(false);
  });

  it("checks the custom env path when envFile is given", async () => {
    await seedAll();
    expect(isConfigured(join(dir, "custom.env"))).toBe(false);
    await writeFile(join(dir, "custom.env"), "X=1\n", "utf8");
    expect(isConfigured(join(dir, "custom.env"))).toBe(true);
  });
});
