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

const sqliteProbe = vi.hoisted(() => ({ error: undefined as Error | undefined }));

vi.mock("node:sqlite", () => ({
  DatabaseSync: class {
    exec(): void {
      if (sqliteProbe.error) throw sqliteProbe.error;
    }
    close = (): undefined => undefined;
  },
}));

const { ensureReady, parseClaudeAuthStatus } = await import("../src/preflight.js");
const { logger } = await import("../src/logger.js");

describe("ensureReady", () => {
  let dir: string;
  let binDir: string;
  let systemPromptsDir: string;
  let restoreEnv: () => void;

  async function stubClaude(body: string): Promise<void> {
    const claude = join(binDir, "claude");
    await writeFile(claude, `#!/bin/sh\n${body}\n`, "utf8");
    await chmod(claude, 0o755);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await createTempDir();
    binDir = join(dir, "bin");
    restoreEnv = snapshotEnv();

    await mkdir(binDir, { recursive: true });
    await stubClaude("exit 0");

    await seedProject(dir);
    systemPromptsDir = await seedSystemPrompts(dir);

    process.env.PATH = binDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    restoreEnv();
    sqliteProbe.error = undefined;
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

  it("does not probe the login when claude is missing", async () => {
    process.env.PATH = join(dir, "empty");
    await expect(ensureReady(dirs())).rejects.not.toThrow(/not logged in/);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("passes when claude auth status reports a login and names the method", async () => {
    await stubClaude(
      `echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'`,
    );
    await expect(ensureReady(dirs())).resolves.toBeDefined();
    expect(logger.success).toHaveBeenCalledWith("Claude Code login (claude.ai)");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("names the API key source when one is in use", async () => {
    await stubClaude(
      `echo '{"loggedIn":true,"authMethod":"oauth_token","apiKeySource":"ANTHROPIC_API_KEY"}'`,
    );
    await expect(ensureReady(dirs())).resolves.toBeDefined();
    expect(logger.success).toHaveBeenCalledWith("Claude Code login (ANTHROPIC_API_KEY)");
  });

  it("throws with a login hint when claude is not logged in", async () => {
    await stubClaude(`echo '{"loggedIn":false,"authMethod":"none"}'; exit 1`);
    await expect(ensureReady(dirs())).rejects.toThrow(
      /Preflight failed[\s\S]*not logged in[\s\S]*claude auth login[\s\S]*ANTHROPIC_API_KEY/,
    );
  });

  it("warns and passes when the CLI does not know auth status", async () => {
    await stubClaude(`echo "error: unknown command 'auth'" >&2; exit 1`);
    await expect(ensureReady(dirs())).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Could not verify"));
  });

  it("warns and passes when auth status prints no JSON", async () => {
    await stubClaude("echo not json");
    await expect(ensureReady(dirs())).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("warns and passes when auth status hangs past the timeout", async () => {
    await stubClaude("sleep 5");
    await expect(
      ensureReady(dirs(), { authStatusTimeoutMs: 100 }),
    ).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("throws with a configure hint when a prompt file is missing", async () => {
    await removeTempDir(join(dir, ".brownie", "prompts"));
    await expect(ensureReady(dirs())).rejects.toThrow(/interactive terminal/);
  });

  it("throws with a Node build hint when SQLite lacks FTS5", async () => {
    sqliteProbe.error = new Error("no such module: fts5");
    await expect(ensureReady(dirs())).rejects.toThrow(
      /Preflight failed[\s\S]*FTS5[\s\S]*nodejs\.org/,
    );
  });

  it("throws when the settings file is missing", async () => {
    await removeTempDir(join(dir, ".brownie", "settings.json"));
    await expect(ensureReady(dirs())).rejects.toThrow(
      /Preflight failed[\s\S]*interactive terminal/,
    );
  });
});

describe("parseClaudeAuthStatus", () => {
  it("parses the JSON document", () => {
    expect(
      parseClaudeAuthStatus(
        '{"loggedIn":true,"authMethod":"claude.ai","apiKeySource":"ANTHROPIC_API_KEY"}\n',
      ),
    ).toEqual({
      loggedIn: true,
      authMethod: "claude.ai",
      apiKeySource: "ANTHROPIC_API_KEY",
    });
  });

  it("skips noise printed before and after the document", () => {
    expect(
      parseClaudeAuthStatus('warning: something\n{"loggedIn":false}\ntrailing'),
    ).toEqual({ loggedIn: false, authMethod: undefined, apiKeySource: undefined });
  });

  it.each(["", "not json", "{broken", '{"authMethod":"none"}', "[1,2]", '"text"'])(
    "returns null for %j",
    (output) => {
      expect(parseClaudeAuthStatus(output)).toBeNull();
    },
  );
});
