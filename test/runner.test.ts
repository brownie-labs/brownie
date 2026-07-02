import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildConfig,
  createTempDir,
  fakeClaudeEnv,
  fakeClaudePath,
  removeTempDir,
} from "./helpers.js";

vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { runSession } = await import("../src/runner.js");
const { sessionLogger } = await import("../src/logger.js");

describe("runSession (integracja z atrapą claude)", () => {
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await createTempDir();
  });

  afterEach(() => removeTempDir(dir));

  it("zwraca sukces i podsumowanie z result", async () => {
    const config = buildConfig({
      command: fakeClaudePath,
      childEnv: fakeClaudeEnv("ok"),
    });
    const result = await runSession(config, new AbortController().signal);

    expect(result.ok).toBe(true);
    expect(result.costUsd).toBeCloseTo(0.0123);
    expect(result.numTurns).toBe(2);
    expect(result.sessionId).toBe("sess-1");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it("zwraca błąd, gdy result ma is_error", async () => {
    const config = buildConfig({
      command: fakeClaudePath,
      childEnv: fakeClaudeEnv("error_result"),
    });
    const result = await runSession(config, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Sesja zakończona błędem (is_error)");
  }, 15_000);

  it("zwraca błąd z kodem wyjścia przy niezerowym kodzie", async () => {
    const config = buildConfig({
      command: fakeClaudePath,
      childEnv: fakeClaudeEnv("exit_nonzero"),
    });
    const result = await runSession(config, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Proces zakończył się kodem 2");
  }, 15_000);

  it("zwraca błąd spawn, gdy komendy nie ma", async () => {
    const config = buildConfig({ command: "claude-nie-istnieje-xyz" });
    const result = await runSession(config, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^Nie udało się uruchomić/);
  }, 15_000);

  it("ubija sesję po przekroczeniu timeoutu", async () => {
    const config = buildConfig({
      command: fakeClaudePath,
      childEnv: fakeClaudeEnv("hang"),
      sessionTimeoutMs: 200,
    });
    const result = await runSession(config, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Przekroczono limit czasu sesji");
  }, 15_000);

  it("przerywa sesję na sygnał abort", async () => {
    const config = buildConfig({
      command: fakeClaudePath,
      childEnv: fakeClaudeEnv("hang"),
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const result = await runSession(config, controller.signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Sesja przerwana");
  }, 15_000);

  it("loguje stderr procesu potomnego jako debug", async () => {
    const config = buildConfig({
      command: fakeClaudePath,
      childEnv: fakeClaudeEnv("exit_nonzero"),
    });
    await runSession(config, new AbortController().signal);

    expect(sessionLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("stderr: coś poszło nie tak"),
    );
  }, 15_000);

  it("rzuca, gdy plik promptu nie istnieje", async () => {
    const config = buildConfig({
      command: fakeClaudePath,
      promptPath: join(dir, "nie-ma.md"),
      childEnv: fakeClaudeEnv("ok"),
    });
    await expect(runSession(config, new AbortController().signal)).rejects.toThrow(
      /ENOENT/,
    );
  }, 15_000);

  it("przekazuje prompt na stdin procesu potomnego", async () => {
    const promptPath = join(dir, "prompt.md");
    const out = join(dir, "otrzymany-prompt.txt");
    await writeFile(promptPath, "moje zadanie\n", "utf8");

    const config = buildConfig({
      command: fakeClaudePath,
      promptPath,
      childEnv: fakeClaudeEnv("ok", { FAKE_CLAUDE_PROMPT_OUT: out }),
    });
    await runSession(config, new AbortController().signal);

    expect(await readFile(out, "utf8")).toBe("moje zadanie\n");
  }, 15_000);
});
