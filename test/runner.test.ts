import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSession } from "../src/runner.js";
import {
  buildSessionSpec,
  createSessionEventCollector,
  createTempDir,
  fakeClaudeEnv,
  removeTempDir,
  type SessionEventCollector,
} from "./helpers.js";

describe("runSession (integration with fake claude)", () => {
  let dir: string;
  let collector: SessionEventCollector;

  beforeEach(async () => {
    dir = await createTempDir();
    collector = createSessionEventCollector();
  });

  afterEach(() => removeTempDir(dir));

  it("returns success and a summary from result", async () => {
    const spec = buildSessionSpec(collector.sink, { childEnv: fakeClaudeEnv("ok") });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(true);
    expect(result.costUsd).toBeCloseTo(0.0123);
    expect(result.numTurns).toBe(2);
    expect(result.sessionId).toBe("sess-1");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it("passes resultText from the result event", async () => {
    const spec = buildSessionSpec(collector.sink, {
      childEnv: fakeClaudeEnv("ok", {
        FAKE_CLAUDE_RESULT_TEXT: '{"tasks": []}',
      }),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(true);
    expect(result.resultText).toBe('{"tasks": []}');
  }, 15_000);

  it("returns an error when result has is_error", async () => {
    const spec = buildSessionSpec(collector.sink, {
      childEnv: fakeClaudeEnv("error_result"),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Session ended with an error (is_error)");
    expect(result.failureReason).toBe("isError");
  }, 15_000);

  it("surfaces the 401 api_retry and terminal reason of an invalid token", async () => {
    const spec = buildSessionSpec(collector.sink, {
      childEnv: fakeClaudeEnv("auth_error"),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe("isError");
    expect(result.apiError).toEqual({ status: 401, code: "authentication_failed" });
    expect(result.terminalReason).toBe("api_error");
    expect(result.resultText).toContain("401");
  }, 15_000);

  it("passes the not-logged-in result text without an api error", async () => {
    const spec = buildSessionSpec(collector.sink, {
      childEnv: fakeClaudeEnv("not_logged_in"),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.apiError).toBeUndefined();
    expect(result.resultText).toBe("Not logged in · Please run /login");
  }, 15_000);

  it("returns an error with the exit code on a non-zero code", async () => {
    const spec = buildSessionSpec(collector.sink, {
      childEnv: fakeClaudeEnv("exit_nonzero"),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Process exited with code 2");
  }, 15_000);

  it("returns a spawn error when the command is missing", async () => {
    const spec = buildSessionSpec(collector.sink, {
      command: "claude-does-not-exist-xyz",
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^Failed to start/);
  }, 15_000);

  it("kills the session after the timeout is exceeded", async () => {
    const spec = buildSessionSpec(collector.sink, {
      childEnv: fakeClaudeEnv("hang"),
      sessionTimeoutMs: 200,
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Session timed out");
    expect(result.failureReason).toBe("timeout");
  }, 15_000);

  it("aborts the session on the abort signal", async () => {
    const spec = buildSessionSpec(collector.sink, { childEnv: fakeClaudeEnv("hang") });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const result = await runSession(spec, controller.signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Session aborted");
  }, 15_000);

  it("emits child process stderr as a session event", async () => {
    const spec = buildSessionSpec(collector.sink, {
      childEnv: fakeClaudeEnv("exit_nonzero"),
    });
    await runSession(spec, new AbortController().signal);

    expect(collector.events).toContainEqual({
      type: "stderr",
      line: expect.stringContaining("something went wrong") as string,
    });
  }, 15_000);

  it("always runs the session in bypassPermissions mode", async () => {
    const out = join(dir, "received-args.json");
    const spec = buildSessionSpec(collector.sink, {
      childEnv: fakeClaudeEnv("ok", { FAKE_CLAUDE_ARGS_OUT: out }),
    });
    await runSession(spec, new AbortController().signal);

    const args = JSON.parse(await readFile(out, "utf8")) as string[];
    const flagIndex = args.indexOf("--permission-mode");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toBe("bypassPermissions");
  }, 15_000);

  it("passes the effort from the spec as the --effort flag", async () => {
    const out = join(dir, "args-effort.json");
    const spec = buildSessionSpec(collector.sink, {
      effort: "max",
      childEnv: fakeClaudeEnv("ok", { FAKE_CLAUDE_ARGS_OUT: out }),
    });
    await runSession(spec, new AbortController().signal);

    const args = JSON.parse(await readFile(out, "utf8")) as string[];
    const flagIndex = args.indexOf("--effort");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toBe("max");
  }, 15_000);

  it("with mcpConfig passes it as an additive --mcp-config without --strict-mcp-config", async () => {
    const out = join(dir, "args-mcp.json");
    const mcpConfig = '{"mcpServers":{"memory":{"command":"node","args":[]}}}';
    const spec = buildSessionSpec(collector.sink, {
      mcpConfig,
      childEnv: fakeClaudeEnv("ok", { FAKE_CLAUDE_ARGS_OUT: out }),
    });
    await runSession(spec, new AbortController().signal);

    const args = JSON.parse(await readFile(out, "utf8")) as string[];
    const flagIndex = args.indexOf("--mcp-config");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toBe(mcpConfig);
    expect(args).not.toContain("--strict-mcp-config");
  }, 15_000);

  it("without mcpConfig passes no MCP flags so the Claude Code configuration is inherited", async () => {
    const out = join(dir, "args-without-mcp.json");
    const spec = buildSessionSpec(collector.sink, {
      childEnv: fakeClaudeEnv("ok", { FAKE_CLAUDE_ARGS_OUT: out }),
    });
    await runSession(spec, new AbortController().signal);

    const args = JSON.parse(await readFile(out, "utf8")) as string[];
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).not.toContain("--json-schema");
  }, 15_000);

  it("with jsonSchema adds the --json-schema flag", async () => {
    const out = join(dir, "args-json-schema.json");
    const jsonSchema = '{"type":"object"}';
    const spec = buildSessionSpec(collector.sink, {
      jsonSchema,
      childEnv: fakeClaudeEnv("ok", { FAKE_CLAUDE_ARGS_OUT: out }),
    });
    await runSession(spec, new AbortController().signal);

    const args = JSON.parse(await readFile(out, "utf8")) as string[];
    const flagIndex = args.indexOf("--json-schema");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toBe(jsonSchema);
  }, 15_000);

  it("passes the prompt from the spec to the child process stdin", async () => {
    const out = join(dir, "received-prompt.txt");
    const spec = buildSessionSpec(collector.sink, {
      prompt: "my task\n",
      childEnv: fakeClaudeEnv("ok", { FAKE_CLAUDE_PROMPT_OUT: out }),
    });
    await runSession(spec, new AbortController().signal);

    expect(await readFile(out, "utf8")).toBe("my task\n");
  }, 15_000);

  it("selects the fake behavior by model (_MODEL suffix)", async () => {
    const spec = buildSessionSpec(collector.sink, {
      model: "haiku",
      childEnv: fakeClaudeEnv("exit_nonzero", {
        FAKE_CLAUDE_MODE_HAIKU: "ok",
        FAKE_CLAUDE_RESULT_TEXT_HAIKU: "haiku report",
      }),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(true);
    expect(result.resultText).toBe("haiku report");
  }, 15_000);

  it("passes the fable alias through to the --model flag untouched", async () => {
    const out = join(dir, "args-fable.json");
    const spec = buildSessionSpec(collector.sink, {
      model: "fable",
      childEnv: fakeClaudeEnv("exit_nonzero", {
        FAKE_CLAUDE_MODE_FABLE: "ok",
        FAKE_CLAUDE_ARGS_OUT_FABLE: out,
      }),
    });
    const result = await runSession(spec, new AbortController().signal);

    expect(result.ok).toBe(true);
    const args = JSON.parse(await readFile(out, "utf8")) as string[];
    const flagIndex = args.indexOf("--model");
    expect(args[flagIndex + 1]).toBe("fable");
  }, 15_000);

  it("carries the session meta into the init event", async () => {
    const spec = buildSessionSpec(collector.sink, {
      meta: { agent: "executor", taskId: "ci-42" },
      childEnv: fakeClaudeEnv("ok"),
    });
    await runSession(spec, new AbortController().signal);

    expect(collector.events).toContainEqual({
      type: "init",
      model: "haiku",
      sessionId: "sess-1",
      toolCount: 2,
      taskId: "ci-42",
      cycle: undefined,
    });
  }, 15_000);

  it("records the session in the index, opening it on init and closing it on the result", async () => {
    const started = vi.fn();
    const finished = vi.fn();
    const spec = buildSessionSpec(collector.sink, {
      meta: { agent: "monitor", cycle: 3 },
      index: { started, finished },
      childEnv: fakeClaudeEnv("ok"),
    });

    await runSession(spec, new AbortController().signal);

    expect(started).toHaveBeenCalledWith({
      sessionId: "sess-1",
      agent: "monitor",
      cycle: 3,
      taskId: undefined,
      model: "haiku",
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
    });
    expect(finished).toHaveBeenCalledWith({
      sessionId: "sess-1",
      finishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
      ok: true,
      failureReason: undefined,
      costUsd: 0.0123,
      numTurns: 2,
    });
  }, 15_000);

  it("closes a killed session with its failure reason and no cost", async () => {
    const finished = vi.fn();
    const controller = new AbortController();
    const spec = buildSessionSpec(collector.sink, {
      index: { started: vi.fn(), finished },
      childEnv: fakeClaudeEnv("hang_after_init"),
    });
    const running = runSession(spec, controller.signal);
    await vi.waitFor(() =>
      expect(collector.events).toContainEqual(expect.objectContaining({ type: "init" })),
    );
    controller.abort();
    await running;

    expect(finished).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, failureReason: "abort", costUsd: undefined }),
    );
  }, 15_000);

  it("records nothing when the session never reaches init", async () => {
    const started = vi.fn();
    const finished = vi.fn();
    const spec = buildSessionSpec(collector.sink, {
      command: join(dir, "missing-binary"),
      index: { started, finished },
    });

    const result = await runSession(spec, new AbortController().signal);

    expect(result.failureReason).toBe("spawn");
    expect(started).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
  }, 15_000);
});
