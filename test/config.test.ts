import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMMAND,
  expandHome,
  loadSettings,
  loadWorkerConfig,
  resolvePromptPaths,
  settingsSchema,
} from "../src/config.js";
import { packagePromptsDir } from "../src/paths.js";
import {
  createTempDir,
  removeTempDir,
  seedProject,
  seedSystemPrompts,
  snapshotEnv,
} from "./helpers.js";

describe("expandHome", () => {
  it("replaces a bare ~ with the home directory", () => {
    expect(expandHome("~")).toBe(homedir());
  });

  it("expands ~/subpath", () => {
    expect(expandHome("~/project")).toBe(resolve(homedir(), "project"));
  });

  it("leaves a path without ~ unchanged", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
    expect(expandHome("relative/x")).toBe("relative/x");
  });

  it("does not expand ~ without a slash", () => {
    expect(expandHome("~other")).toBe("~other");
  });
});

describe("settingsSchema", () => {
  it("applies default values to an empty object", () => {
    const settings = settingsSchema.parse({});
    expect(settings.monitor.model).toBe("sonnet");
    expect(settings.monitor.effort).toBe("medium");
    expect(settings.monitor.intervalMinutes).toBe(15);
    expect(settings.monitor.activeHours).toBeUndefined();
    expect(settings.monitor.activeDays).toBeUndefined();
    expect(settings.executor.model).toBe("opus");
    expect(settings.executor.effort).toBe("high");
    expect(settings.executor.maxTaskAttempts).toBe(3);
    expect(settings.executor.retryDelayMs).toBe(30_000);
    expect(settings.summarizer.model).toBe("sonnet");
    expect(settings.summarizer.effort).toBe("medium");
    expect(settings.summarizer.sessionTimeoutMs).toBe(300_000);
    expect(settings.streamPartial).toBe(true);
    expect(settings.claudeConfigDir).toBeUndefined();
  });

  it("rejects a non-positive monitor interval", () => {
    expect(settingsSchema.safeParse({ monitor: { intervalMinutes: 0 } }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ monitor: { intervalMinutes: -5 } }).success).toBe(
      false,
    );
  });

  it("accepts a fractional monitor interval", () => {
    const settings = settingsSchema.parse({ monitor: { intervalMinutes: 1.5 } });
    expect(settings.monitor.intervalMinutes).toBe(1.5);
  });

  it("rejects an unknown effort level", () => {
    expect(settingsSchema.safeParse({ monitor: { effort: "turbo" } }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ executor: { effort: "turbo" } }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ summarizer: { effort: "turbo" } }).success).toBe(
      false,
    );
  });

  it("rejects a non-boolean streamPartial", () => {
    expect(settingsSchema.safeParse({ streamPartial: "yes" }).success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    expect(settingsSchema.safeParse({ montior: {} }).success).toBe(false);
  });

  it("rejects an unknown nested key", () => {
    expect(settingsSchema.safeParse({ monitor: { modle: "opus" } }).success).toBe(false);
  });

  it("accepts valid active hours and days", () => {
    const settings = settingsSchema.parse({
      monitor: { activeHours: "08:00-18:00", activeDays: "mon-fri" },
    });
    expect(settings.monitor.activeHours).toBe("08:00-18:00");
    expect(settings.monitor.activeDays).toBe("mon-fri");
  });

  it("rejects an invalid active hours format", () => {
    expect(settingsSchema.safeParse({ monitor: { activeHours: "8-18" } }).success).toBe(
      false,
    );
  });

  it("rejects identical start and end of active hours", () => {
    expect(
      settingsSchema.safeParse({ monitor: { activeHours: "08:00-08:00" } }).success,
    ).toBe(false);
  });

  it("rejects an unknown active day", () => {
    expect(settingsSchema.safeParse({ monitor: { activeDays: "mo" } }).success).toBe(
      false,
    );
  });
});

describe("loadSettings", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it("throws with a configure hint when the file is missing", async () => {
    await expect(loadSettings(join(dir, "settings.json"))).rejects.toThrow(
      /brownie --configure/,
    );
  });

  it("throws a readable error on invalid JSON", async () => {
    const file = join(dir, "settings.json");
    await writeFile(file, "{", "utf8");
    await expect(loadSettings(file)).rejects.toThrow(/Invalid JSON in/);
  });

  it("throws a validation error naming the key on a schema violation", async () => {
    const file = join(dir, "settings.json");
    await writeFile(file, JSON.stringify({ monitor: { effort: "turbo" } }), "utf8");
    await expect(loadSettings(file)).rejects.toThrow(
      /Invalid configuration[\s\S]*monitor\.effort/,
    );
  });

  it("parses valid settings with defaults filled in", async () => {
    const file = join(dir, "settings.json");
    await writeFile(file, JSON.stringify({ monitor: { model: "haiku" } }), "utf8");
    const settings = await loadSettings(file);
    expect(settings.monitor.model).toBe("haiku");
    expect(settings.executor.model).toBe("opus");
  });
});

describe("resolvePromptPaths", () => {
  it("resolves project prompts under .brownie and system prompts from the given dir", () => {
    const paths = resolvePromptPaths({
      projectDir: "/proj",
      systemPromptsDir: "/sys",
    });
    expect(paths.monitor.promptPath).toBe(
      join("/proj", ".brownie", "prompts", "monitor.prompt.md"),
    );
    expect(paths.monitor.systemPromptPath).toBe(join("/sys", "monitor.system.md"));
    expect(paths.executor.promptPath).toBe(
      join("/proj", ".brownie", "prompts", "executor.prompt.md"),
    );
    expect(paths.executor.systemPromptPath).toBe(join("/sys", "executor.system.md"));
    expect(paths.summarizer.systemPromptPath).toBe(join("/sys", "summarizer.system.md"));
  });

  it("defaults to process.cwd() and the packaged prompts directory", () => {
    const paths = resolvePromptPaths();
    expect(paths.monitor.promptPath).toBe(
      join(process.cwd(), ".brownie", "prompts", "monitor.prompt.md"),
    );
    expect(paths.monitor.systemPromptPath).toBe(
      join(packagePromptsDir, "monitor.system.md"),
    );
    expect(paths.summarizer.systemPromptPath).toBe(
      join(packagePromptsDir, "summarizer.system.md"),
    );
  });
});

describe("loadWorkerConfig", () => {
  let dir: string;
  let systemPromptsDir: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    dir = await createTempDir();
    systemPromptsDir = await seedSystemPrompts(dir);
    restoreEnv = snapshotEnv();
  });

  afterEach(async () => {
    restoreEnv();
    await removeTempDir(dir);
  });

  function dirs() {
    return { projectDir: dir, systemPromptsDir };
  }

  it("builds a full WorkerConfig from valid settings", async () => {
    await seedProject(dir, {
      settings: {
        monitor: {
          model: "sonnet",
          effort: "low",
          intervalMinutes: 1,
          sessionTimeoutMs: 120_000,
        },
        executor: { model: "opus", effort: "max" },
        summarizer: { model: "sonnet", effort: "medium", sessionTimeoutMs: 90_000 },
      },
    });

    const config = await loadWorkerConfig(dirs());

    expect(config.command).toBe(COMMAND);
    expect(config.monitor.model).toBe("sonnet");
    expect(config.monitor.effort).toBe("low");
    expect(config.monitor.intervalMs).toBe(60_000);
    expect(config.monitor.sessionTimeoutMs).toBe(120_000);
    expect(config.monitor.promptPath).toBe(
      join(dir, ".brownie", "prompts", "monitor.prompt.md"),
    );
    expect(config.monitor.systemPromptPath).toBe(
      join(systemPromptsDir, "monitor.system.md"),
    );
    expect(config.executor.model).toBe("opus");
    expect(config.executor.effort).toBe("max");
    expect(config.summarizer.sessionTimeoutMs).toBe(90_000);
    expect(config.cwd).toBe(dir);
    expect(config.tasksFilePath).toBe(join(dir, ".brownie", "data", "tasks.json"));
    expect(config.memoryDbPath).toBe(join(dir, ".brownie", "data", "memory.db"));
    expect(config.logsDir).toBe(join(dir, ".brownie", "logs"));
    const mcpConfig = JSON.parse(config.executor.mcpConfig) as {
      mcpServers: { memory: { command: string; args: string[] } };
    };
    expect(mcpConfig.mcpServers.memory.command).toBe(process.execPath);
    expect(mcpConfig.mcpServers.memory.args).toContain("mcp");
    expect(mcpConfig.mcpServers.memory.args).toContain(
      join(dir, ".brownie", "data", "memory.db"),
    );
    expect(config.streamPartial).toBe(true);
    expect(config.monitor.schedule).toBeNull();
  });

  it("rounds a fractional interval to whole milliseconds", async () => {
    await seedProject(dir, { settings: { monitor: { intervalMinutes: 1.5 } } });

    const config = await loadWorkerConfig(dirs());

    expect(config.monitor.intervalMs).toBe(90_000);
  });

  it("builds the monitor schedule from active hours and days", async () => {
    await seedProject(dir, {
      settings: { monitor: { activeHours: "08:00-18:00", activeDays: "mon-fri" } },
    });

    const config = await loadWorkerConfig(dirs());

    expect(config.monitor.schedule).toEqual({
      startMinute: 480,
      endMinute: 1080,
      days: [1, 2, 3, 4, 5],
    });
  });

  it("throws when any prompt file is missing", async () => {
    await seedProject(dir);
    await removeTempDir(join(dir, ".brownie", "prompts", "executor.prompt.md"));

    await expect(loadWorkerConfig(dirs())).rejects.toThrow(/executor prompt file/);
  });

  it("throws when the summarizer system prompt file is missing", async () => {
    await seedProject(dir);
    await removeTempDir(join(systemPromptsDir, "summarizer.system.md"));

    await expect(loadWorkerConfig(dirs())).rejects.toThrow(
      /summarizer system prompt file/,
    );
  });

  it("throws a readable validation error on bad settings", async () => {
    await seedProject(dir, { settings: { monitor: { intervalMinutes: -1 } } });

    await expect(loadWorkerConfig(dirs())).rejects.toThrow(/Invalid configuration/);
  });

  it("with passed verified paths skips re-validating the files", async () => {
    await seedProject(dir);
    const verified = {
      monitor: {
        promptPath: join(dir, "missing-m.md"),
        systemPromptPath: join(dir, "missing-ms.md"),
      },
      executor: {
        promptPath: join(dir, "missing-e.md"),
        systemPromptPath: join(dir, "missing-es.md"),
      },
      summarizer: {
        systemPromptPath: join(dir, "missing-ss.md"),
      },
    };

    const config = await loadWorkerConfig({ projectDir: dir }, verified);

    expect(config.monitor.promptPath).toBe(verified.monitor.promptPath);
    expect(config.monitor.systemPromptPath).toBe(verified.monitor.systemPromptPath);
    expect(config.executor.promptPath).toBe(verified.executor.promptPath);
    expect(config.executor.systemPromptPath).toBe(verified.executor.systemPromptPath);
    expect(config.summarizer.systemPromptPath).toBe(verified.summarizer.systemPromptPath);
  });

  it("expands ~ in claudeConfigDir and puts it into childEnv", async () => {
    await seedProject(dir, { settings: { claudeConfigDir: "~/claude-profile" } });
    delete process.env.CLAUDE_CONFIG_DIR;

    const config = await loadWorkerConfig(dirs());

    expect(config.childEnv.CLAUDE_CONFIG_DIR).toBe(resolve(homedir(), "claude-profile"));
  });

  it("prefers claudeConfigDir from settings over the inherited env var", async () => {
    await seedProject(dir, { settings: { claudeConfigDir: "~/from-settings" } });
    process.env.CLAUDE_CONFIG_DIR = "~/from-env";

    const config = await loadWorkerConfig(dirs());

    expect(config.childEnv.CLAUDE_CONFIG_DIR).toBe(resolve(homedir(), "from-settings"));
  });

  it("expands the inherited CLAUDE_CONFIG_DIR when settings leave it unset", async () => {
    await seedProject(dir);
    process.env.CLAUDE_CONFIG_DIR = "~/from-env";

    const config = await loadWorkerConfig(dirs());

    expect(config.childEnv.CLAUDE_CONFIG_DIR).toBe(resolve(homedir(), "from-env"));
  });
});
