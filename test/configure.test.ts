import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consola } from "consola";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir, removeTempDir } from "./helpers.js";

vi.mock("../src/logger.js", () => ({
  logger: { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sessionLogger: { warn: vi.fn() },
}));

const { configureCommand } = await import("../src/configure.js");

function runConfigure(): Promise<void> {
  return (configureCommand.run as (ctx: unknown) => Promise<void>)({});
}

function queueAnswers(...answers: unknown[]): void {
  const prompt = vi.spyOn(consola, "prompt");
  for (const answer of answers) prompt.mockResolvedValueOnce(answer as never);
}

describe("configureCommand", () => {
  let dir: string;
  let envPath: string;
  let promptPath: string;

  beforeEach(async () => {
    dir = await createTempDir();
    envPath = join(dir, ".env");
    promptPath = join(dir, "prompts", "prompt.md");
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await removeTempDir(dir);
  });

  it("zapisuje .env i prompt bez CLAUDE_CONFIG_DIR", async () => {
    queueAnswers("sonnet", "5", "zrób raport", false);
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MODEL=sonnet");
    expect(env).toContain("CLAUDE_WORKER_INTERVAL_MS=300000");
    expect(env).not.toContain("CLAUDE_CONFIG_DIR");
    expect(await readFile(promptPath, "utf8")).toBe("zrób raport\n");
  });

  it("dopisuje CLAUDE_CONFIG_DIR gdy wybrany", async () => {
    queueAnswers("haiku", "2", "zadanie", true, "~/profil-claude");
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_CONFIG_DIR=~/profil-claude");
  });

  it("ponawia pytanie o interwał przy błędnej wartości", async () => {
    queueAnswers("haiku", "0", "abc", "3", "zadanie", false);
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_INTERVAL_MS=180000");
  });

  it("obsługuje przecinek dziesiętny w interwale", async () => {
    queueAnswers("haiku", "1,5", "zadanie", false);
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_INTERVAL_MS=90000");
  });

  it("anulowanie nie zapisuje żadnych plików", async () => {
    const cancelled = new Error("anulowano");
    cancelled.name = "ConsolaPromptCancelledError";
    vi.spyOn(consola, "prompt").mockRejectedValueOnce(cancelled as never);

    await expect(runConfigure()).resolves.toBeUndefined();
    expect(existsSync(envPath)).toBe(false);
    expect(existsSync(promptPath)).toBe(false);
  });

  it("odmowa nadpisania istniejących plików kończy bez zmian", async () => {
    await writeFile(envPath, "STARE=1\n", "utf8");
    vi.spyOn(consola, "prompt").mockResolvedValueOnce(false as never);

    await runConfigure();

    expect(await readFile(envPath, "utf8")).toBe("STARE=1\n");
  });
});
