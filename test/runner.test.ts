import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConfig, createTempDir, fakeClaudePath, removeTempDir } from "./helpers.js";

vi.mock("../src/logger.js", () => {
  const noop = {
    info: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { logger: noop, sessionLogger: noop };
});

const { runSession } = await import("../src/runner.js");

function childEnv(mode: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, FAKE_CLAUDE_MODE: mode, ...extra };
}

describe("runSession (integracja z atrapą claude)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(() => removeTempDir(dir));

  it("zwraca sukces i podsumowanie z result", async () => {
    const config = buildConfig({
      command: fakeClaudePath,
      childEnv: childEnv("ok"),
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
      childEnv: childEnv("error_result"),
    });
    const result = await runSession(config, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Sesja zakończona błędem (is_error)");
  }, 15_000);

  it("zwraca błąd z kodem wyjścia przy niezerowym kodzie", async () => {
    const config = buildConfig({
      command: fakeClaudePath,
      childEnv: childEnv("exit_nonzero"),
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
      childEnv: childEnv("hang"),
      sessionTimeoutMs: 200,
    });
    const result = await runSession(config, new AbortController().signal);

    expect(result.ok).toBe(false);
  }, 15_000);

  it("przerywa sesję na sygnał abort", async () => {
    const config = buildConfig({
      command: fakeClaudePath,
      childEnv: childEnv("hang"),
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const result = await runSession(config, controller.signal);

    expect(result.ok).toBe(false);
  }, 15_000);

  it("przekazuje prompt na stdin procesu potomnego", async () => {
    const promptPath = join(dir, "prompt.md");
    const out = join(dir, "otrzymany-prompt.txt");
    await writeFile(promptPath, "moje zadanie\n", "utf8");

    const config = buildConfig({
      command: fakeClaudePath,
      promptPath,
      childEnv: childEnv("ok", { FAKE_CLAUDE_PROMPT_OUT: out }),
    });
    await runSession(config, new AbortController().signal);

    expect(await readFile(out, "utf8")).toBe("moje zadanie\n");
  }, 15_000);
});
