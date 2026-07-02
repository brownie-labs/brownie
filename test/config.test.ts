import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND,
  envSchema,
  expandHome,
  loadWorkerConfig,
  resolveEnvPath,
  resolveFromCwd,
  resolvePromptPaths,
} from "../src/config.js";
import { createTempDir, removeTempDir, snapshotEnv } from "./helpers.js";

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

describe("resolveEnvPath", () => {
  it("without an argument points to .env in cwd", () => {
    expect(resolveEnvPath()).toBe(resolve(process.cwd(), ".env"));
  });

  it("with a relative argument resolves from cwd", () => {
    expect(resolveEnvPath("other.env")).toBe(resolve("other.env"));
  });

  it("with an absolute argument returns it as is", () => {
    expect(resolveEnvPath("/etc/worker.env")).toBe("/etc/worker.env");
  });
});

describe("resolveFromCwd", () => {
  it("returns an absolute path unchanged", () => {
    expect(resolveFromCwd("/abs")).toBe("/abs");
  });

  it("resolves a relative path from cwd", () => {
    expect(resolveFromCwd("a/b")).toBe(resolve(process.cwd(), "a/b"));
  });

  it("expands ~ before resolving", () => {
    expect(resolveFromCwd("~")).toBe(homedir());
    expect(resolveFromCwd("~/x")).toBe(resolve(homedir(), "x"));
  });
});

describe("envSchema", () => {
  it("applies default values", () => {
    const env = envSchema.parse({});
    expect(env.CLAUDE_WORKER_MONITOR_MODEL).toBe("sonnet");
    expect(env.CLAUDE_WORKER_MONITOR_EFFORT).toBe("medium");
    expect(env.CLAUDE_WORKER_MONITOR_INTERVAL_MS).toBe(900_000);
    expect(env.CLAUDE_WORKER_MONITOR_PROMPT_FILE).toBe("./prompts/monitor.prompt.md");
    expect(env.CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE).toBe(
      "./prompts/monitor.system.md",
    );
    expect(env.CLAUDE_WORKER_EXECUTOR_MODEL).toBe("opus");
    expect(env.CLAUDE_WORKER_EXECUTOR_EFFORT).toBe("high");
    expect(env.CLAUDE_WORKER_EXECUTOR_PROMPT_FILE).toBe("./prompts/executor.prompt.md");
    expect(env.CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE).toBe(
      "./prompts/executor.system.md",
    );
    expect(env.CLAUDE_WORKER_SUMMARIZER_MODEL).toBe("sonnet");
    expect(env.CLAUDE_WORKER_SUMMARIZER_EFFORT).toBe("medium");
    expect(env.CLAUDE_WORKER_SUMMARIZER_SYSTEM_PROMPT_FILE).toBe(
      "./prompts/summarizer.system.md",
    );
    expect(env.CLAUDE_WORKER_SUMMARIZER_SESSION_TIMEOUT_MS).toBe(300_000);
    expect(env.CLAUDE_WORKER_MEMORY_DB).toBe("./data/memory.db");
    expect(env.CLAUDE_WORKER_TASKS_FILE).toBe("./data/tasks.json");
    expect(env.CLAUDE_WORKER_LOGS_DIR).toBe("./logs");
    expect(env.CLAUDE_WORKER_STREAM_PARTIAL).toBe(true);
    expect(env.CLAUDE_WORKER_CWD).toBe("./workspace");
  });

  it.each(["1", "true", "yes", "on", "ON", "True"])(
    "treats %s as true for STREAM_PARTIAL",
    (value) => {
      expect(
        envSchema.parse({ CLAUDE_WORKER_STREAM_PARTIAL: value })
          .CLAUDE_WORKER_STREAM_PARTIAL,
      ).toBe(true);
    },
  );

  it.each(["0", "false", "no", "off", "whatever"])(
    "treats %s as false for STREAM_PARTIAL",
    (value) => {
      expect(
        envSchema.parse({ CLAUDE_WORKER_STREAM_PARTIAL: value })
          .CLAUDE_WORKER_STREAM_PARTIAL,
      ).toBe(false);
    },
  );

  it("empty STREAM_PARTIAL uses the default true", () => {
    expect(
      envSchema.parse({ CLAUDE_WORKER_STREAM_PARTIAL: "  " })
        .CLAUDE_WORKER_STREAM_PARTIAL,
    ).toBe(true);
  });

  it("rejects a non-positive monitor interval", () => {
    expect(envSchema.safeParse({ CLAUDE_WORKER_MONITOR_INTERVAL_MS: "0" }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ CLAUDE_WORKER_MONITOR_INTERVAL_MS: "-5" }).success).toBe(
      false,
    );
  });

  it("rejects a non-integer monitor interval", () => {
    expect(
      envSchema.safeParse({ CLAUDE_WORKER_MONITOR_INTERVAL_MS: "1.5" }).success,
    ).toBe(false);
  });

  it("rejects an unknown effort level", () => {
    expect(envSchema.safeParse({ CLAUDE_WORKER_MONITOR_EFFORT: "turbo" }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ CLAUDE_WORKER_EXECUTOR_EFFORT: "turbo" }).success).toBe(
      false,
    );
    expect(
      envSchema.safeParse({ CLAUDE_WORKER_SUMMARIZER_EFFORT: "turbo" }).success,
    ).toBe(false);
  });

  it("leaves active hours and days unset by default", () => {
    const env = envSchema.parse({});
    expect(env.CLAUDE_WORKER_MONITOR_ACTIVE_HOURS).toBeUndefined();
    expect(env.CLAUDE_WORKER_MONITOR_ACTIVE_DAYS).toBeUndefined();
  });

  it("accepts valid active hours and days", () => {
    const env = envSchema.parse({
      CLAUDE_WORKER_MONITOR_ACTIVE_HOURS: "08:00-18:00",
      CLAUDE_WORKER_MONITOR_ACTIVE_DAYS: "mon-fri",
    });
    expect(env.CLAUDE_WORKER_MONITOR_ACTIVE_HOURS).toBe("08:00-18:00");
    expect(env.CLAUDE_WORKER_MONITOR_ACTIVE_DAYS).toBe("mon-fri");
  });

  it("rejects an invalid active hours format", () => {
    expect(
      envSchema.safeParse({ CLAUDE_WORKER_MONITOR_ACTIVE_HOURS: "8-18" }).success,
    ).toBe(false);
  });

  it("rejects identical start and end of active hours", () => {
    expect(
      envSchema.safeParse({ CLAUDE_WORKER_MONITOR_ACTIVE_HOURS: "08:00-08:00" }).success,
    ).toBe(false);
  });

  it("rejects an unknown active day", () => {
    expect(envSchema.safeParse({ CLAUDE_WORKER_MONITOR_ACTIVE_DAYS: "mo" }).success).toBe(
      false,
    );
  });
});

describe("resolvePromptPaths", () => {
  it("resolves paths for all agents from parsed env", () => {
    const paths = resolvePromptPaths(
      envSchema.parse({
        CLAUDE_WORKER_MONITOR_PROMPT_FILE: "custom/m.md",
        CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE: "/abs/ms.md",
        CLAUDE_WORKER_EXECUTOR_PROMPT_FILE: "custom/e.md",
        CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE: "/abs/es.md",
        CLAUDE_WORKER_SUMMARIZER_SYSTEM_PROMPT_FILE: "/abs/ss.md",
      }),
    );
    expect(paths.monitor.promptPath).toBe(resolve(process.cwd(), "custom/m.md"));
    expect(paths.monitor.systemPromptPath).toBe("/abs/ms.md");
    expect(paths.executor.promptPath).toBe(resolve(process.cwd(), "custom/e.md"));
    expect(paths.executor.systemPromptPath).toBe("/abs/es.md");
    expect(paths.summarizer.systemPromptPath).toBe("/abs/ss.md");
  });

  it("uses default paths with an empty source", () => {
    const paths = resolvePromptPaths(envSchema.parse({}));
    expect(paths.monitor.promptPath).toBe(
      resolve(process.cwd(), "./prompts/monitor.prompt.md"),
    );
    expect(paths.monitor.systemPromptPath).toBe(
      resolve(process.cwd(), "./prompts/monitor.system.md"),
    );
    expect(paths.executor.promptPath).toBe(
      resolve(process.cwd(), "./prompts/executor.prompt.md"),
    );
    expect(paths.executor.systemPromptPath).toBe(
      resolve(process.cwd(), "./prompts/executor.system.md"),
    );
    expect(paths.summarizer.systemPromptPath).toBe(
      resolve(process.cwd(), "./prompts/summarizer.system.md"),
    );
  });
});

describe("loadWorkerConfig", () => {
  let dir: string;
  let restoreEnv: () => void;

  beforeEach(async () => {
    dir = await createTempDir();
    restoreEnv = snapshotEnv();
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    restoreEnv();
    await removeTempDir(dir);
  });

  async function writeEnv(content: string): Promise<void> {
    await writeFile(join(dir, ".env"), content, "utf8");
  }

  const PROMPT_FILE_ENV = [
    "CLAUDE_WORKER_MONITOR_PROMPT_FILE=./m.md",
    "CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE=./ms.md",
    "CLAUDE_WORKER_EXECUTOR_PROMPT_FILE=./e.md",
    "CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE=./es.md",
    "CLAUDE_WORKER_SUMMARIZER_SYSTEM_PROMPT_FILE=./ss.md",
  ];

  async function writePrompts(): Promise<void> {
    for (const name of ["m.md", "ms.md", "e.md", "es.md", "ss.md"]) {
      await writeFile(join(dir, name), `${name}\n`, "utf8");
    }
  }

  it("builds a full WorkerConfig from a valid .env", async () => {
    await writePrompts();
    await writeEnv(
      [
        "CLAUDE_WORKER_MONITOR_MODEL=sonnet",
        "CLAUDE_WORKER_MONITOR_EFFORT=low",
        "CLAUDE_WORKER_MONITOR_INTERVAL_MS=60000",
        "CLAUDE_WORKER_MONITOR_SESSION_TIMEOUT_MS=120000",
        "CLAUDE_WORKER_EXECUTOR_MODEL=opus",
        "CLAUDE_WORKER_EXECUTOR_EFFORT=max",
        "CLAUDE_WORKER_SUMMARIZER_MODEL=sonnet",
        "CLAUDE_WORKER_SUMMARIZER_EFFORT=medium",
        "CLAUDE_WORKER_SUMMARIZER_SESSION_TIMEOUT_MS=90000",
        ...PROMPT_FILE_ENV,
        "CLAUDE_WORKER_TASKS_FILE=./state/tasks.json",
        "CLAUDE_WORKER_MEMORY_DB=./state/memory.db",
        "CLAUDE_WORKER_LOGS_DIR=./log-output",
        "CLAUDE_WORKER_CWD=./ws",
      ].join("\n"),
    );

    const config = await loadWorkerConfig();

    expect(config.command).toBe(COMMAND);
    expect(config.monitor.model).toBe("sonnet");
    expect(config.monitor.effort).toBe("low");
    expect(config.monitor.intervalMs).toBe(60000);
    expect(config.monitor.sessionTimeoutMs).toBe(120000);
    expect(config.monitor.promptPath).toBe(join(dir, "m.md"));
    expect(config.monitor.systemPromptPath).toBe(join(dir, "ms.md"));
    expect(config.executor.model).toBe("opus");
    expect(config.executor.effort).toBe("max");
    expect(config.executor.promptPath).toBe(join(dir, "e.md"));
    expect(config.executor.systemPromptPath).toBe(join(dir, "es.md"));
    expect(config.summarizer.model).toBe("sonnet");
    expect(config.summarizer.effort).toBe("medium");
    expect(config.summarizer.sessionTimeoutMs).toBe(90000);
    expect(config.summarizer.systemPromptPath).toBe(join(dir, "ss.md"));
    expect(config.tasksFilePath).toBe(join(dir, "state", "tasks.json"));
    expect(config.memoryDbPath).toBe(join(dir, "state", "memory.db"));
    const mcpConfig = JSON.parse(config.executor.mcpConfig) as {
      mcpServers: { memory: { command: string; args: string[] } };
    };
    expect(mcpConfig.mcpServers.memory.command).toBe(process.execPath);
    expect(mcpConfig.mcpServers.memory.args).toContain("mcp");
    expect(mcpConfig.mcpServers.memory.args).toContain(join(dir, "state", "memory.db"));
    expect(config.logsDir).toBe(join(dir, "log-output"));
    expect(config.cwd).toBe(join(dir, "ws"));
    expect(config.streamPartial).toBe(true);
    expect(config.monitor.schedule).toBeNull();
  });

  it("builds the monitor schedule from active hours and days", async () => {
    await writePrompts();
    await writeEnv(
      [
        "CLAUDE_WORKER_MONITOR_ACTIVE_HOURS=08:00-18:00",
        "CLAUDE_WORKER_MONITOR_ACTIVE_DAYS=mon-fri",
        ...PROMPT_FILE_ENV,
      ].join("\n"),
    );

    const config = await loadWorkerConfig();

    expect(config.monitor.schedule).toEqual({
      startMinute: 480,
      endMinute: 1080,
      days: [1, 2, 3, 4, 5],
    });
  });

  it("throws when any prompt file is missing", async () => {
    await writePrompts();
    await removeTempDir(join(dir, "e.md"));
    await writeEnv(PROMPT_FILE_ENV.join("\n"));

    await expect(loadWorkerConfig()).rejects.toThrow(/executor prompt file/);
  });

  it("throws a readable validation error on a bad env", async () => {
    await writePrompts();
    await writeEnv(
      ["CLAUDE_WORKER_MONITOR_INTERVAL_MS=-1", ...PROMPT_FILE_ENV].join("\n"),
    );

    await expect(loadWorkerConfig()).rejects.toThrow(/Invalid configuration/);
  });

  it("with passed verified paths skips re-validating the files", async () => {
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

    const config = await loadWorkerConfig(undefined, verified);

    expect(config.monitor.promptPath).toBe(verified.monitor.promptPath);
    expect(config.monitor.systemPromptPath).toBe(verified.monitor.systemPromptPath);
    expect(config.executor.promptPath).toBe(verified.executor.promptPath);
    expect(config.executor.systemPromptPath).toBe(verified.executor.systemPromptPath);
    expect(config.summarizer.systemPromptPath).toBe(verified.summarizer.systemPromptPath);
  });

  it("throws when the summarizer system prompt file is missing", async () => {
    await writePrompts();
    await removeTempDir(join(dir, "ss.md"));
    await writeEnv(PROMPT_FILE_ENV.join("\n"));

    await expect(loadWorkerConfig()).rejects.toThrow(/summarizer system prompt file/);
  });

  it("expands ~ in CLAUDE_CONFIG_DIR in childEnv", async () => {
    await writePrompts();
    await writeEnv([...PROMPT_FILE_ENV, "CLAUDE_CONFIG_DIR=~/claude-profile"].join("\n"));
    delete process.env.CLAUDE_CONFIG_DIR;

    const config = await loadWorkerConfig();

    expect(config.childEnv.CLAUDE_CONFIG_DIR).toBe(resolve(homedir(), "claude-profile"));
  });
});
