import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamRenderer } from "../src/stream.js";
import { createFakeLogger, type FakeLogger } from "./helpers.js";

describe("StreamRenderer", () => {
  let logger: FakeLogger;
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = createFakeLogger();
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function line(event: unknown): string {
    return JSON.stringify(event);
  }

  it("ignoruje puste linie", () => {
    const r = new StreamRenderer(logger.instance, false);
    r.handleLine("");
    r.handleLine("   ");
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("linię nie-JSON loguje jako debug z prefiksem", () => {
    const r = new StreamRenderer(logger.instance, false);
    r.handleLine("to nie json");
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("(nie-JSON)"));
  });

  it("system/init loguje model, sesję i liczbę narzędzi", () => {
    const r = new StreamRenderer(logger.instance, false);
    r.handleLine(
      line({
        type: "system",
        subtype: "init",
        model: "haiku",
        session_id: "sess-9",
        tools: ["Read", "Bash", "Edit"],
      }),
    );
    const msg = logger.info.mock.calls[0]?.[0] as string;
    expect(msg).toContain("haiku");
    expect(msg).toContain("sess-9");
    expect(msg).toContain("3");
  });

  it("assistant: tekst loguje przez log, tool_use przez info", () => {
    const r = new StreamRenderer(logger.instance, false);
    r.handleLine(
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
    expect(logger.log).toHaveBeenCalledWith("Cześć");
    const toolMsg = logger.info.mock.calls[0]?.[0] as string;
    expect(toolMsg).toContain("🔧");
    expect(toolMsg).toContain("Bash");
  });

  it("assistant: pusty tekst jest pomijany", () => {
    const r = new StreamRenderer(logger.instance, false);
    r.handleLine(
      line({ type: "assistant", message: { content: [{ type: "text", text: "   " }] } }),
    );
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("user: tool_result loguje debug, błąd z prefiksem ostrzeżenia", () => {
    const r = new StreamRenderer(logger.instance, false);
    r.handleLine(
      line({
        type: "user",
        message: {
          content: [{ type: "tool_result", content: "ok", is_error: false }],
        },
      }),
    );
    r.handleLine(
      line({
        type: "user",
        message: {
          content: [{ type: "tool_result", content: "boom", is_error: true }],
        },
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("↳ wynik"));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("⚠ wynik(błąd)"));
  });

  it("stream_event z partialem włączonym pisze delta na stdout", () => {
    const r = new StreamRenderer(logger.instance, true);
    r.handleLine(
      line({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "abc" },
        },
      }),
    );
    expect(stdoutWrite).toHaveBeenCalledWith("abc");
  });

  it("stream_event z partialem wyłączonym nie pisze na stdout", () => {
    const r = new StreamRenderer(logger.instance, false);
    r.handleLine(
      line({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "abc" },
        },
      }),
    );
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it("domyka otwarty partial przed kolejnym zdarzeniem", () => {
    const r = new StreamRenderer(logger.instance, true);
    r.handleLine(
      line({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "abc" },
        },
      }),
    );
    r.handleLine(
      line({ type: "assistant", message: { content: [{ type: "text", text: "koniec" }] } }),
    );
    expect(stdoutWrite).toHaveBeenCalledWith("\n");
  });

  it("getSummary domyka partial i zwraca podsumowanie z result", () => {
    const r = new StreamRenderer(logger.instance, true);
    r.handleLine(
      line({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "x" },
        },
      }),
    );
    r.handleLine(
      line({
        type: "result",
        is_error: false,
        total_cost_usd: 0.5,
        num_turns: 4,
        session_id: "sess-3",
      }),
    );
    const summary = r.getSummary();
    expect(summary).toEqual({
      is_error: false,
      costUsd: 0.5,
      numTurns: 4,
      sessionId: "sess-3",
    });
  });

  it("truncate obcina długie wejście narzędzia z wielokropkiem", () => {
    const r = new StreamRenderer(logger.instance, false);
    const long = "a".repeat(1000);
    r.handleLine(
      line({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash", input: { command: long } }],
        },
      }),
    );
    const msg = logger.info.mock.calls[0]?.[0] as string;
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(long.length);
  });
});
