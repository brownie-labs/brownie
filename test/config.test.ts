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
  it("zamienia samo ~ na katalog domowy", () => {
    expect(expandHome("~")).toBe(homedir());
  });

  it("rozwija ~/podścieżka", () => {
    expect(expandHome("~/projekt")).toBe(resolve(homedir(), "projekt"));
  });

  it("pozostawia ścieżkę bez ~ bez zmian", () => {
    expect(expandHome("/abs/ścieżka")).toBe("/abs/ścieżka");
    expect(expandHome("względna/x")).toBe("względna/x");
  });

  it("nie rozwija ~ bez ukośnika", () => {
    expect(expandHome("~inne")).toBe("~inne");
  });
});

describe("resolveEnvPath", () => {
  it("bez argumentu wskazuje .env w cwd", () => {
    expect(resolveEnvPath()).toBe(resolve(process.cwd(), ".env"));
  });

  it("z argumentem względnym rozwiązuje od cwd", () => {
    expect(resolveEnvPath("inny.env")).toBe(resolve("inny.env"));
  });

  it("z argumentem bezwzględnym zwraca go wprost", () => {
    expect(resolveEnvPath("/etc/worker.env")).toBe("/etc/worker.env");
  });
});

describe("resolveFromCwd", () => {
  it("ścieżkę bezwzględną zwraca bez zmian", () => {
    expect(resolveFromCwd("/abs")).toBe("/abs");
  });

  it("względną rozwiązuje od cwd", () => {
    expect(resolveFromCwd("a/b")).toBe(resolve(process.cwd(), "a/b"));
  });

  it("rozwija ~ przed rozwiązaniem", () => {
    expect(resolveFromCwd("~")).toBe(homedir());
    expect(resolveFromCwd("~/x")).toBe(resolve(homedir(), "x"));
  });
});

describe("envSchema", () => {
  it("stosuje wartości domyślne", () => {
    const env = envSchema.parse({});
    expect(env.CLAUDE_WORKER_MONITOR_MODEL).toBe("haiku");
    expect(env.CLAUDE_WORKER_MONITOR_INTERVAL_MS).toBe(300_000);
    expect(env.CLAUDE_WORKER_MONITOR_PROMPT_FILE).toBe("./prompts/monitor.prompt.md");
    expect(env.CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE).toBe(
      "./prompts/monitor.system.md",
    );
    expect(env.CLAUDE_WORKER_EXECUTOR_MODEL).toBe("opus");
    expect(env.CLAUDE_WORKER_EXECUTOR_PROMPT_FILE).toBe("./prompts/executor.prompt.md");
    expect(env.CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE).toBe(
      "./prompts/executor.system.md",
    );
    expect(env.CLAUDE_WORKER_TASKS_FILE).toBe("./data/tasks.json");
    expect(env.CLAUDE_WORKER_STREAM_PARTIAL).toBe(true);
    expect(env.CLAUDE_WORKER_CWD).toBe("./workspace");
  });

  it.each(["1", "true", "yes", "on", "ON", "True"])(
    "traktuje %s jako true dla STREAM_PARTIAL",
    (value) => {
      expect(
        envSchema.parse({ CLAUDE_WORKER_STREAM_PARTIAL: value })
          .CLAUDE_WORKER_STREAM_PARTIAL,
      ).toBe(true);
    },
  );

  it.each(["0", "false", "no", "off", "cokolwiek"])(
    "traktuje %s jako false dla STREAM_PARTIAL",
    (value) => {
      expect(
        envSchema.parse({ CLAUDE_WORKER_STREAM_PARTIAL: value })
          .CLAUDE_WORKER_STREAM_PARTIAL,
      ).toBe(false);
    },
  );

  it("pusty STREAM_PARTIAL korzysta z domyślnego true", () => {
    expect(
      envSchema.parse({ CLAUDE_WORKER_STREAM_PARTIAL: "  " })
        .CLAUDE_WORKER_STREAM_PARTIAL,
    ).toBe(true);
  });

  it("odrzuca niepozytywny interwał monitora", () => {
    expect(envSchema.safeParse({ CLAUDE_WORKER_MONITOR_INTERVAL_MS: "0" }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ CLAUDE_WORKER_MONITOR_INTERVAL_MS: "-5" }).success).toBe(
      false,
    );
  });

  it("odrzuca niecałkowity interwał monitora", () => {
    expect(
      envSchema.safeParse({ CLAUDE_WORKER_MONITOR_INTERVAL_MS: "1.5" }).success,
    ).toBe(false);
  });
});

describe("resolvePromptPaths", () => {
  it("rozwiązuje ścieżki obu agentów ze sparsowanego env", () => {
    const paths = resolvePromptPaths(
      envSchema.parse({
        CLAUDE_WORKER_MONITOR_PROMPT_FILE: "custom/m.md",
        CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE: "/abs/ms.md",
        CLAUDE_WORKER_EXECUTOR_PROMPT_FILE: "custom/e.md",
        CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE: "/abs/es.md",
      }),
    );
    expect(paths.monitor.promptPath).toBe(resolve(process.cwd(), "custom/m.md"));
    expect(paths.monitor.systemPromptPath).toBe("/abs/ms.md");
    expect(paths.executor.promptPath).toBe(resolve(process.cwd(), "custom/e.md"));
    expect(paths.executor.systemPromptPath).toBe("/abs/es.md");
  });

  it("używa domyślnych ścieżek przy pustym źródle", () => {
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
  ];

  async function writePrompts(): Promise<void> {
    for (const name of ["m.md", "ms.md", "e.md", "es.md"]) {
      await writeFile(join(dir, name), `${name}\n`, "utf8");
    }
  }

  it("buduje pełny WorkerConfig z poprawnego .env", async () => {
    await writePrompts();
    await writeEnv(
      [
        "CLAUDE_WORKER_MONITOR_MODEL=sonnet",
        "CLAUDE_WORKER_MONITOR_INTERVAL_MS=60000",
        "CLAUDE_WORKER_MONITOR_SESSION_TIMEOUT_MS=120000",
        "CLAUDE_WORKER_EXECUTOR_MODEL=opus",
        ...PROMPT_FILE_ENV,
        "CLAUDE_WORKER_TASKS_FILE=./stan/tasks.json",
        "CLAUDE_WORKER_CWD=./ws",
      ].join("\n"),
    );

    const config = await loadWorkerConfig();

    expect(config.command).toBe(COMMAND);
    expect(config.monitor.model).toBe("sonnet");
    expect(config.monitor.intervalMs).toBe(60000);
    expect(config.monitor.sessionTimeoutMs).toBe(120000);
    expect(config.monitor.promptPath).toBe(join(dir, "m.md"));
    expect(config.monitor.systemPromptPath).toBe(join(dir, "ms.md"));
    expect(config.executor.model).toBe("opus");
    expect(config.executor.promptPath).toBe(join(dir, "e.md"));
    expect(config.executor.systemPromptPath).toBe(join(dir, "es.md"));
    expect(config.tasksFilePath).toBe(join(dir, "stan", "tasks.json"));
    expect(config.cwd).toBe(join(dir, "ws"));
    expect(config.streamPartial).toBe(true);
  });

  it("rzuca, gdy brak któregokolwiek pliku promptu", async () => {
    await writePrompts();
    await removeTempDir(join(dir, "e.md"));
    await writeEnv(PROMPT_FILE_ENV.join("\n"));

    await expect(loadWorkerConfig()).rejects.toThrow(/plik promptu egzekutora/);
  });

  it("rzuca czytelny błąd walidacji przy błędnym env", async () => {
    await writePrompts();
    await writeEnv(
      ["CLAUDE_WORKER_MONITOR_INTERVAL_MS=-1", ...PROMPT_FILE_ENV].join("\n"),
    );

    await expect(loadWorkerConfig()).rejects.toThrow(/Nieprawidłowa konfiguracja/);
  });

  it("z przekazanymi zweryfikowanymi ścieżkami pomija ponowną walidację plików", async () => {
    const verified = {
      monitor: {
        promptPath: join(dir, "nie-ma-m.md"),
        systemPromptPath: join(dir, "nie-ma-ms.md"),
      },
      executor: {
        promptPath: join(dir, "nie-ma-e.md"),
        systemPromptPath: join(dir, "nie-ma-es.md"),
      },
    };

    const config = await loadWorkerConfig(undefined, verified);

    expect(config.monitor.promptPath).toBe(verified.monitor.promptPath);
    expect(config.monitor.systemPromptPath).toBe(verified.monitor.systemPromptPath);
    expect(config.executor.promptPath).toBe(verified.executor.promptPath);
    expect(config.executor.systemPromptPath).toBe(verified.executor.systemPromptPath);
  });

  it("rozwija ~ w CLAUDE_CONFIG_DIR w childEnv", async () => {
    await writePrompts();
    await writeEnv([...PROMPT_FILE_ENV, "CLAUDE_CONFIG_DIR=~/profil-claude"].join("\n"));
    delete process.env.CLAUDE_CONFIG_DIR;

    const config = await loadWorkerConfig();

    expect(config.childEnv.CLAUDE_CONFIG_DIR).toBe(resolve(homedir(), "profil-claude"));
  });
});
