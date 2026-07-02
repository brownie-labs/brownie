import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consola } from "consola";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir, removeTempDir } from "./helpers.js";

vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

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

  it("zapisuje .env i prompty obu agentów bez CLAUDE_CONFIG_DIR", async () => {
    queueAnswers(
      "haiku",
      "15",
      "",
      [],
      "obserwuj Redmine",
      "opus",
      "wykonuj rzetelnie",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_MODEL=haiku");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_INTERVAL_MS=900000");
    expect(env).toContain("CLAUDE_WORKER_EXECUTOR_MODEL=opus");
    expect(env).not.toContain("CLAUDE_CONFIG_DIR");
    expect(env).not.toContain("CLAUDE_WORKER_MONITOR_ACTIVE_HOURS");
    expect(env).not.toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS");
    expect(await readFile(monitorPromptPath, "utf8")).toBe("obserwuj Redmine\n");
    expect(await readFile(executorPromptPath, "utf8")).toBe("wykonuj rzetelnie\n");
  });

  it("zapisuje godziny i wybrane dni pracy monitora", async () => {
    queueAnswers(
      "haiku",
      "15",
      "08:00-18:00",
      ["mon", "tue", "wed", "thu", "fri"],
      "obserwuj",
      "opus",
      "wykonuj",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_ACTIVE_HOURS=08:00-18:00");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS=mon,tue,wed,thu,fri");
  });

  it("normalizuje kolejność zaznaczonych dni", async () => {
    queueAnswers(
      "haiku",
      "15",
      "",
      ["fri", "mon", "wed"],
      "obserwuj",
      "opus",
      "wykonuj",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS=mon,wed,fri");
  });

  it("pomija dni gdy zaznaczono wszystkie", async () => {
    queueAnswers(
      "haiku",
      "15",
      "",
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      "obserwuj",
      "opus",
      "wykonuj",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).not.toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS");
  });

  it("ponawia pytanie o godziny pracy przy błędnym formacie", async () => {
    queueAnswers(
      "haiku",
      "15",
      "zła wartość",
      "08:00-18:00",
      [],
      "obserwuj",
      "opus",
      "wykonuj",
      false,
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_ACTIVE_HOURS=08:00-18:00");
    expect(env).not.toContain("CLAUDE_WORKER_MONITOR_ACTIVE_DAYS");
  });

  it("dopisuje CLAUDE_CONFIG_DIR gdy wybrany", async () => {
    queueAnswers(
      "haiku",
      "2",
      "",
      [],
      "obserwuj",
      "sonnet",
      "wykonuj",
      true,
      "~/profil-claude",
    );
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_CONFIG_DIR=~/profil-claude");
    expect(env).toContain("CLAUDE_WORKER_EXECUTOR_MODEL=sonnet");
  });

  it("ponawia pytanie o interwał przy błędnej wartości", async () => {
    queueAnswers("haiku", "0", "abc", "3", "", [], "obserwuj", "opus", "wykonuj", false);
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_INTERVAL_MS=180000");
  });

  it("obsługuje przecinek dziesiętny w interwale", async () => {
    queueAnswers("haiku", "1,5", "", [], "obserwuj", "opus", "wykonuj", false);
    await runConfigure();

    const env = await readFile(envPath, "utf8");
    expect(env).toContain("CLAUDE_WORKER_MONITOR_INTERVAL_MS=90000");
  });

  it("anulowanie nie zapisuje żadnych plików", async () => {
    const cancelled = new Error("anulowano");
    cancelled.name = "ConsolaPromptCancelledError";
    vi.spyOn(consola, "prompt").mockRejectedValueOnce(cancelled);

    await expect(runConfigure()).resolves.toBeUndefined();
    expect(existsSync(envPath)).toBe(false);
    expect(existsSync(monitorPromptPath)).toBe(false);
    expect(existsSync(executorPromptPath)).toBe(false);
  });

  it("odmowa nadpisania istniejących plików kończy bez zmian", async () => {
    await writeFile(envPath, "STARE=1\n", "utf8");
    vi.spyOn(consola, "prompt").mockResolvedValueOnce(false);

    await runConfigure();

    expect(await readFile(envPath, "utf8")).toBe("STARE=1\n");
    expect(existsSync(monitorPromptPath)).toBe(false);
  });
});
