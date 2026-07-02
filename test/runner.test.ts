import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("with mcpConfig adds the --mcp-config flag without cutting off profile MCP", async () => {
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

  it("without mcpConfig and jsonSchema does not add their flags", async () => {
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
});
