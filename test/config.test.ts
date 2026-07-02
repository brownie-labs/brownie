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
    expect(env.CLAUDE_WORKER_MODEL).toBe("haiku");
    expect(env.CLAUDE_WORKER_INTERVAL_MS).toBe(300_000);
    expect(env.CLAUDE_WORKER_PROMPT_FILE).toBe("./prompts/prompt.md");
    expect(env.CLAUDE_WORKER_SYSTEM_PROMPT_FILE).toBe("./prompts/system.md");
    expect(env.CLAUDE_WORKER_STREAM_PARTIAL).toBe(true);
    expect(env.CLAUDE_WORKER_CWD).toBe("./workspace");
    expect(env.CLAUDE_WORKER_PERMISSION_MODE).toBeUndefined();
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

  it("odrzuca niepozytywny interwał", () => {
    expect(envSchema.safeParse({ CLAUDE_WORKER_INTERVAL_MS: "0" }).success).toBe(false);
    expect(envSchema.safeParse({ CLAUDE_WORKER_INTERVAL_MS: "-5" }).success).toBe(false);
  });

  it("odrzuca niecałkowity interwał", () => {
    expect(envSchema.safeParse({ CLAUDE_WORKER_INTERVAL_MS: "1.5" }).success).toBe(false);
  });

  it("odrzuca tryb uprawnień spoza enuma", () => {
    expect(
      envSchema.safeParse({ CLAUDE_WORKER_PERMISSION_MODE: "wymyślony" }).success,
    ).toBe(false);
  });

  it("akceptuje poprawny tryb uprawnień", () => {
    expect(
      envSchema.parse({ CLAUDE_WORKER_PERMISSION_MODE: "plan" })
        .CLAUDE_WORKER_PERMISSION_MODE,
    ).toBe("plan");
  });
});

describe("resolvePromptPaths", () => {
  it("rozwiązuje ścieżki ze sparsowanego env", () => {
    const { promptPath, systemPromptPath } = resolvePromptPaths(
      envSchema.parse({
        CLAUDE_WORKER_PROMPT_FILE: "custom/p.md",
        CLAUDE_WORKER_SYSTEM_PROMPT_FILE: "/abs/s.md",
      }),
    );
    expect(promptPath).toBe(resolve(process.cwd(), "custom/p.md"));
    expect(systemPromptPath).toBe("/abs/s.md");
  });

  it("używa domyślnych ścieżek przy pustym źródle", () => {
    const { promptPath, systemPromptPath } = resolvePromptPaths(envSchema.parse({}));
    expect(promptPath).toBe(resolve(process.cwd(), "./prompts/prompt.md"));
    expect(systemPromptPath).toBe(resolve(process.cwd(), "./prompts/system.md"));
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

  async function writePrompts(): Promise<void> {
    await writeFile(join(dir, "prompt.md"), "zadanie\n", "utf8");
    await writeFile(join(dir, "system.md"), "system\n", "utf8");
  }

  it("buduje pełny WorkerConfig z poprawnego .env", async () => {
    await writePrompts();
    await writeEnv(
      [
        "CLAUDE_WORKER_MODEL=sonnet",
        "CLAUDE_WORKER_INTERVAL_MS=60000",
        "CLAUDE_WORKER_PROMPT_FILE=./prompt.md",
        "CLAUDE_WORKER_SYSTEM_PROMPT_FILE=./system.md",
        "CLAUDE_WORKER_CWD=./ws",
      ].join("\n"),
    );

    const config = await loadWorkerConfig();

    expect(config.command).toBe(COMMAND);
    expect(config.model).toBe("sonnet");
    expect(config.intervalMs).toBe(60000);
    expect(config.promptPath).toBe(join(dir, "prompt.md"));
    expect(config.systemPromptPath).toBe(join(dir, "system.md"));
    expect(config.cwd).toBe(join(dir, "ws"));
    expect(config.streamPartial).toBe(true);
  });

  it("rzuca, gdy brak pliku promptu", async () => {
    await writeFile(join(dir, "system.md"), "system\n", "utf8");
    await writeEnv(
      [
        "CLAUDE_WORKER_PROMPT_FILE=./prompt.md",
        "CLAUDE_WORKER_SYSTEM_PROMPT_FILE=./system.md",
      ].join("\n"),
    );

    await expect(loadWorkerConfig()).rejects.toThrow(/plik promptu/);
  });

  it("rzuca czytelny błąd walidacji przy błędnym env", async () => {
    await writePrompts();
    await writeEnv(
      [
        "CLAUDE_WORKER_INTERVAL_MS=-1",
        "CLAUDE_WORKER_PROMPT_FILE=./prompt.md",
        "CLAUDE_WORKER_SYSTEM_PROMPT_FILE=./system.md",
      ].join("\n"),
    );

    await expect(loadWorkerConfig()).rejects.toThrow(/Nieprawidłowa konfiguracja/);
  });

  it("z przekazanymi zweryfikowanymi ścieżkami pomija ponowną walidację plików", async () => {
    const verified = {
      promptPath: join(dir, "nie-ma-prompt.md"),
      systemPromptPath: join(dir, "nie-ma-system.md"),
    };

    const config = await loadWorkerConfig(undefined, verified);

    expect(config.promptPath).toBe(verified.promptPath);
    expect(config.systemPromptPath).toBe(verified.systemPromptPath);
  });

  it("rozwija ~ w CLAUDE_CONFIG_DIR w childEnv", async () => {
    await writePrompts();
    await writeEnv(
      [
        "CLAUDE_WORKER_PROMPT_FILE=./prompt.md",
        "CLAUDE_WORKER_SYSTEM_PROMPT_FILE=./system.md",
        "CLAUDE_CONFIG_DIR=~/profil-claude",
      ].join("\n"),
    );
    delete process.env.CLAUDE_CONFIG_DIR;

    const config = await loadWorkerConfig();

    expect(config.childEnv.CLAUDE_CONFIG_DIR).toBe(resolve(homedir(), "profil-claude"));
  });
});
