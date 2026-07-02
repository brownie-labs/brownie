import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../src/session-events.js";
import { StreamRenderer } from "../src/stream.js";

function createRenderer(streamPartial = false): {
  events: SessionEvent[];
  renderer: StreamRenderer;
} {
  const events: SessionEvent[] = [];
  const renderer = new StreamRenderer((event) => events.push(event), streamPartial);
  return { events, renderer };
}

function line(event: unknown): string {
  return JSON.stringify(event);
}

describe("StreamRenderer", () => {
  it("ignoruje puste linie", () => {
    const { events, renderer } = createRenderer();
    renderer.handleLine("");
    renderer.handleLine("   ");
    expect(events).toEqual([]);
  });

  it("linię nie-JSON emituje jako zdarzenie raw", () => {
    const { events, renderer } = createRenderer();
    renderer.handleLine("to nie json");
    expect(events).toEqual([{ type: "raw", line: "to nie json" }]);
  });

  it("system/init emituje model, sesję i liczbę narzędzi", () => {
    const { events, renderer } = createRenderer();
    renderer.handleLine(
      line({
        type: "system",
        subtype: "init",
        model: "haiku",
        session_id: "sess-9",
        tools: ["Read", "Bash", "Edit"],
      }),
    );
    expect(events).toEqual([
      { type: "init", model: "haiku", sessionId: "sess-9", toolCount: 3 },
    ]);
  });

  it("assistant: tekst emituje jako text, tool_use jako toolUse", () => {
    const { events, renderer } = createRenderer();
    renderer.handleLine(
      line({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "  Cześć  " },
            { type: "tool_use", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
    );
    expect(events).toEqual([
      { type: "text", text: "Cześć" },
      { type: "toolUse", name: "Bash", input: '{"command":"ls"}' },
    ]);
  });

  it("assistant: pusty tekst jest pomijany", () => {
    const { events, renderer } = createRenderer();
    renderer.handleLine(
      line({ type: "assistant", message: { content: [{ type: "text", text: "   " }] } }),
    );
    expect(events).toEqual([]);
  });

  it("user: tool_result emituje toolResult z flagą błędu", () => {
    const { events, renderer } = createRenderer();
    renderer.handleLine(
      line({
        type: "user",
        message: {
          content: [{ type: "tool_result", content: "ok", is_error: false }],
        },
      }),
    );
    renderer.handleLine(
      line({
        type: "user",
        message: {
          content: [{ type: "tool_result", content: "boom", is_error: true }],
        },
      }),
    );
    expect(events).toEqual([
      { type: "toolResult", isError: false, content: "ok" },
      { type: "toolResult", isError: true, content: "boom" },
    ]);
  });

  it("stream_event z partialem włączonym emituje partial z deltą", () => {
    const { events, renderer } = createRenderer(true);
    renderer.handleLine(
      line({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "abc" },
        },
      }),
    );
    expect(events).toEqual([{ type: "partial", text: "abc" }]);
  });

  it("stream_event z partialem wyłączonym nic nie emituje", () => {
    const { events, renderer } = createRenderer(false);
    renderer.handleLine(
      line({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "abc" },
        },
      }),
    );
    expect(events).toEqual([]);
  });

  it("result nie emituje zdarzenia, tylko zasila podsumowanie", () => {
    const { events, renderer } = createRenderer();
    renderer.handleLine(
      line({
        type: "result",
        is_error: false,
        total_cost_usd: 0.5,
        num_turns: 4,
        session_id: "sess-3",
      }),
    );
    expect(events).toEqual([]);
    expect(renderer.getSummary()).toEqual({
      isError: false,
      costUsd: 0.5,
      numTurns: 4,
      sessionId: "sess-3",
      resultText: undefined,
    });
  });

  it("getSummary przekazuje tekst z pola result", () => {
    const { renderer } = createRenderer();
    renderer.handleLine(
      line({
        type: "result",
        is_error: false,
        session_id: "sess-5",
        result: '{"tasks": []}',
      }),
    );
    expect(renderer.getSummary().resultText).toBe('{"tasks": []}');
  });

  it("getSummary zwraca isError=true dla result z is_error", () => {
    const { renderer } = createRenderer();
    renderer.handleLine(line({ type: "result", is_error: true, session_id: "sess-err" }));
    const summary = renderer.getSummary();
    expect(summary.isError).toBe(true);
    expect(summary.sessionId).toBe("sess-err");
  });

  it("obcina długie wejście narzędzia z wielokropkiem", () => {
    const { events, renderer } = createRenderer();
    const long = "a".repeat(1000);
    renderer.handleLine(
      line({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash", input: { command: long } }],
        },
      }),
    );
    const [event] = events;
    if (event?.type !== "toolUse") throw new Error("oczekiwano zdarzenia toolUse");
    expect(event.input).toContain("…");
    expect(event.input.length).toBeLessThan(long.length);
  });
});
