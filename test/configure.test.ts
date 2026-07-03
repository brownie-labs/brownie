import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consola } from "consola";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir, removeTempDir, seedProject } from "./helpers.js";

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
  let settingsPath: string;
  let gitignorePath: string;
  let monitorPromptPath: string;
  let executorPromptPath: string;

  beforeEach(async () => {
    dir = await createTempDir();
    settingsPath = join(dir, ".brownie", "settings.json");
    gitignorePath = join(dir, ".brownie", ".gitignore");
    monitorPromptPath = join(dir, ".brownie", "prompts", "monitor.prompt.md");
    executorPromptPath = join(dir, ".brownie", "prompts", "executor.prompt.md");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await removeTempDir(dir);
  });

  async function readSettings(): Promise<unknown> {
    return JSON.parse(await readFile(settingsPath, "utf8"));
  }

  it("writes settings.json and both agents' prompts", async () => {
    queueAnswers(
      "sonnet",
      "medium",
      "15",
      "",
      [],
      "watch Redmine",
      "opus",
      "high",
      "execute diligently",
    );
    await expect(runConfigure(dir)).resolves.toBe(true);

    expect(await readSettings()).toEqual({
      monitor: { model: "sonnet", effort: "medium", intervalMinutes: 15 },
      executor: { model: "opus", effort: "high" },
    });
    expect(await readFile(monitorPromptPath, "utf8")).toBe("watch Redmine\n");
    expect(await readFile(executorPromptPath, "utf8")).toBe("execute diligently\n");
  });

  it("skips the effort question for models without reasoning effort", async () => {
    queueAnswers("haiku", "15", "", [], "watch", "haiku", "execute");
    await expect(runConfigure(dir)).resolves.toBe(true);

    expect(await readSettings()).toEqual({
      monitor: { model: "haiku", intervalMinutes: 15 },
      executor: { model: "haiku" },
    });
  });

  it("creates .brownie/.gitignore ignoring runtime state", async () => {
    queueAnswers("sonnet", "medium", "15", "", [], "watch", "opus", "high", "execute");
    await runConfigure(dir);

    expect(await readFile(gitignorePath, "utf8")).toBe("data/\nlogs/\n");
  });

  it("does not overwrite an existing .brownie/.gitignore", async () => {
    await seedProject(dir);
    await writeFile(gitignorePath, "custom\n", "utf8");
    queueAnswers(
      true,
      "sonnet",
      "medium",
      "15",
      "",
      [],
      "watch",
      "opus",
      "high",
      "execute",
    );
    await runConfigure(dir);

    expect(await readFile(gitignorePath, "utf8")).toBe("custom\n");
  });

  it("preserves manual settings the wizard does not manage when reconfiguring", async () => {
    await seedProject(dir, {
      settings: {
        monitor: { model: "opus", intervalMinutes: 5 },
        executor: { model: "opus" },
        claudeConfigDir: "~/.claude-work",
        streamPartial: false,
      },
    });
    queueAnswers(
      true,
      "sonnet",
      "medium",
      "15",
      "",
      [],
      "watch",
      "opus",
      "high",
      "execute",
    );
    await runConfigure(dir);

    expect(await readSettings()).toEqual({
      monitor: { model: "sonnet", effort: "medium", intervalMinutes: 15 },
      executor: { model: "opus", effort: "high" },
      claudeConfigDir: "~/.claude-work",
      streamPartial: false,
    });
  });

  it("writes the monitor's working hours and selected days", async () => {
    queueAnswers(
      "sonnet",
      "medium",
      "15",
      "08:00-18:00",
      ["mon", "tue", "wed", "thu", "fri"],
      "watch",
      "opus",
      "high",
      "execute",
    );
    await runConfigure(dir);

    const settings = (await readSettings()) as {
      monitor: { activeHours?: string; activeDays?: string };
    };
    expect(settings.monitor.activeHours).toBe("08:00-18:00");
    expect(settings.monitor.activeDays).toBe("mon,tue,wed,thu,fri");
  });

  it("normalizes the order of selected days", async () => {
    queueAnswers(
      "sonnet",
      "medium",
      "15",
      "",
      ["fri", "mon", "wed"],
      "watch",
      "opus",
      "high",
      "execute",
    );
    await runConfigure(dir);

    const settings = (await readSettings()) as { monitor: { activeDays?: string } };
    expect(settings.monitor.activeDays).toBe("mon,wed,fri");
  });

  it("omits days when all are selected", async () => {
    queueAnswers(
      "sonnet",
      "medium",
      "15",
      "",
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      "watch",
      "opus",
      "high",
      "execute",
    );
    await runConfigure(dir);

    const settings = (await readSettings()) as { monitor: { activeDays?: string } };
    expect(settings.monitor.activeDays).toBeUndefined();
  });

  it("re-asks the working hours question on an invalid format", async () => {
    queueAnswers(
      "sonnet",
      "medium",
      "15",
      "bad value",
      "08:00-18:00",
      [],
      "watch",
      "opus",
      "high",
      "execute",
    );
    await runConfigure(dir);

    const settings = (await readSettings()) as {
      monitor: { activeHours?: string; activeDays?: string };
    };
    expect(settings.monitor.activeHours).toBe("08:00-18:00");
    expect(settings.monitor.activeDays).toBeUndefined();
  });

  it("re-asks the interval question on an invalid value", async () => {
    queueAnswers(
      "sonnet",
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
    );
    await runConfigure(dir);

    const settings = (await readSettings()) as {
      monitor: { intervalMinutes: number };
    };
    expect(settings.monitor.intervalMinutes).toBe(3);
  });

  it("handles a decimal comma in the interval", async () => {
    queueAnswers("sonnet", "medium", "1,5", "", [], "watch", "opus", "high", "execute");
    await runConfigure(dir);

    const settings = (await readSettings()) as {
      monitor: { intervalMinutes: number };
    };
    expect(settings.monitor.intervalMinutes).toBe(1.5);
  });

  it("treats empty text and multiselect answers (undefined from consola) as defaults", async () => {
    queueAnswers(
      "sonnet",
      "medium",
      "15",
      undefined,
      undefined,
      undefined,
      "opus",
      "high",
      undefined,
    );

    await expect(runConfigure(dir)).resolves.toBe(true);

    const settings = (await readSettings()) as {
      monitor: { activeHours?: string; activeDays?: string };
    };
    expect(settings.monitor.activeHours).toBeUndefined();
    expect(settings.monitor.activeDays).toBeUndefined();
    expect(await readFile(monitorPromptPath, "utf8")).toBe("\n");
    expect(await readFile(executorPromptPath, "utf8")).toBe("\n");
  });

  it("cancelling writes no files", async () => {
    const cancelled = new Error("cancelled");
    cancelled.name = "ConsolaPromptCancelledError";
    vi.spyOn(consola, "prompt").mockRejectedValueOnce(cancelled);

    await expect(runConfigure(dir)).resolves.toBe(false);
    expect(existsSync(settingsPath)).toBe(false);
    expect(existsSync(monitorPromptPath)).toBe(false);
    expect(existsSync(executorPromptPath)).toBe(false);
  });

  it("declining to overwrite existing files finishes without changes", async () => {
    await seedProject(dir, { settings: '{"old": true}\n' });
    vi.spyOn(consola, "prompt").mockResolvedValueOnce(false);

    await expect(runConfigure(dir)).resolves.toBe(false);

    expect(await readFile(settingsPath, "utf8")).toBe('{"old": true}\n');
  });

  it("defaults to process.cwd() when no project directory is given", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    queueAnswers("sonnet", "medium", "15", "", [], "watch", "opus", "high", "execute");

    await expect(runConfigure()).resolves.toBe(true);

    expect(existsSync(settingsPath)).toBe(true);
  });
});

describe("isConfigured", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await removeTempDir(dir);
  });

  it("returns true when settings.json and both prompt files exist", async () => {
    await seedProject(dir);
    expect(isConfigured(dir)).toBe(true);
  });

  it("returns false when settings.json is missing", async () => {
    await seedProject(dir, { settings: false });
    expect(isConfigured(dir)).toBe(false);
  });

  it("returns false when a prompt file is missing", async () => {
    await seedProject(dir);
    await rm(join(dir, ".brownie", "prompts", "executor.prompt.md"));
    expect(isConfigured(dir)).toBe(false);
  });

  it("defaults to process.cwd() when no project directory is given", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    expect(isConfigured()).toBe(false);
    await seedProject(dir);
    expect(isConfigured()).toBe(true);
  });
});
