import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSession } from "../src/runner.js";
import {
  buildSessionSpec,
  createFakeLogger,
  createTempDir,
  fakeClaudeEnv,
  removeTempDir,
  type FakeLogger,
} from "./helpers.js";

describe("runSession (integracja z atrapą claude)", () => {
  let dir: string;
  let log: FakeLogger;

  beforeEach(async () => {
    dir = await createTempDir();
    log = createFakeLogger();
  });

  afterEach(() => removeTempDir(dir));

  it("zwraca sukces i podsumowanie z result", async () => {
    const spec = buildSessionSpec(log.instance, { childEnv: fakeClaudeEnv("ok") });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(true);
    expect(result.costUsd).toBeCloseTo(0.0123);
    expect(result.numTurns).toBe(2);
    expect(result.sessionId).toBe("sess-1");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it("przekazuje resultText z eventu result", async () => {
    const spec = buildSessionSpec(log.instance, {
      childEnv: fakeClaudeEnv("ok", {
        FAKE_CLAUDE_RESULT_TEXT: '{"tasks": []}',
      }),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(true);
    expect(result.resultText).toBe('{"tasks": []}');
  }, 15_000);

  it("zwraca błąd, gdy result ma is_error", async () => {
    const spec = buildSessionSpec(log.instance, {
      childEnv: fakeClaudeEnv("error_result"),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Sesja zakończona błędem (is_error)");
  }, 15_000);

  it("zwraca błąd z kodem wyjścia przy niezerowym kodzie", async () => {
    const spec = buildSessionSpec(log.instance, {
      childEnv: fakeClaudeEnv("exit_nonzero"),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Proces zakończył się kodem 2");
  }, 15_000);

  it("zwraca błąd spawn, gdy komendy nie ma", async () => {
    const spec = buildSessionSpec(log.instance, {
      command: "claude-nie-istnieje-xyz",
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^Nie udało się uruchomić/);
  }, 15_000);

  it("ubija sesję po przekroczeniu timeoutu", async () => {
    const spec = buildSessionSpec(log.instance, {
      childEnv: fakeClaudeEnv("hang"),
      sessionTimeoutMs: 200,
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Przekroczono limit czasu sesji");
  }, 15_000);

  it("przerywa sesję na sygnał abort", async () => {
    const spec = buildSessionSpec(log.instance, { childEnv: fakeClaudeEnv("hang") });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const result = await runSession(spec, controller.signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Sesja przerwana");
  }, 15_000);

  it("loguje stderr procesu potomnego jako debug przez przekazany logger", async () => {
    const spec = buildSessionSpec(log.instance, {
      childEnv: fakeClaudeEnv("exit_nonzero"),
    });
    await runSession(spec, new AbortController().signal);

    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining("stderr: coś poszło nie tak"),
    );
  }, 15_000);

  it("przekazuje prompt ze speca na stdin procesu potomnego", async () => {
    const out = join(dir, "otrzymany-prompt.txt");
    const spec = buildSessionSpec(log.instance, {
      prompt: "moje zadanie\n",
      childEnv: fakeClaudeEnv("ok", { FAKE_CLAUDE_PROMPT_OUT: out }),
    });
    await runSession(spec, new AbortController().signal);

    expect(await readFile(out, "utf8")).toBe("moje zadanie\n");
  }, 15_000);

  it("wybiera zachowanie atrapy po modelu (sufiks _MODEL)", async () => {
    const spec = buildSessionSpec(log.instance, {
      model: "haiku",
      childEnv: fakeClaudeEnv("exit_nonzero", {
        FAKE_CLAUDE_MODE_HAIKU: "ok",
        FAKE_CLAUDE_RESULT_TEXT_HAIKU: "raport haiku",
      }),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(true);
    expect(result.resultText).toBe("raport haiku");
  }, 15_000);
});
