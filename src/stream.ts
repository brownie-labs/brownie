import { truncate, type SessionEventSink } from "./session-events.js";
import type { SessionSummary } from "./types.js";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
}

function blockText(block: unknown): string {
  if (typeof block !== "object" || block === null || !("text" in block)) return "";
  const { text } = block;
  return typeof text === "string" ? text : "";
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(blockText).filter(Boolean).join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

function unescapeNewlines(text: string): string {
  return text.includes("\n") ? text : text.replaceAll("\\n", "\n");
}

const MAX_RESULT_LINES = 20;
const MAX_RESULT_LINE_LENGTH = 300;

interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  tools?: string[];
  message?: { content?: ContentBlock[] };
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
  };
  duration_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  result?: string;
}

export class StreamRenderer {
  private summary: SessionSummary = {};

  constructor(
    private readonly emit: SessionEventSink,
    private readonly streamPartial: boolean,
  ) {}

  handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch {
      this.emit({ type: "raw", line: truncate(trimmed) });
      return;
    }
    this.handleEvent(event);
  }

  private handleEvent(event: StreamEvent): void {
    switch (event.type) {
      case "system":
        if (event.subtype === "init") {
          this.emit({
            type: "init",
            model: event.model ?? "?",
            sessionId: event.session_id ?? "?",
            toolCount: event.tools?.length ?? 0,
          });
        }
        break;

      case "assistant":
        for (const block of event.message?.content ?? []) {
          if (block.type === "text" && block.text?.trim()) {
            this.emit({ type: "text", text: block.text.trim() });
          } else if (block.type === "tool_use") {
            this.emit({
              type: "toolUse",
              name: block.name ?? "?",
              input: block.input,
            });
          }
        }
        break;

      case "user":
        for (const block of event.message?.content ?? []) {
          if (block.type === "tool_result") {
            const lines = unescapeNewlines(toolResultText(block.content))
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean);
            this.emit({
              type: "toolResult",
              isError: block.is_error ?? false,
              lines: lines
                .slice(0, MAX_RESULT_LINES)
                .map((line) => truncate(line, MAX_RESULT_LINE_LENGTH)),
              dropped: Math.max(0, lines.length - MAX_RESULT_LINES),
            });
          }
        }
        break;

      case "stream_event":
        if (
          this.streamPartial &&
          event.event?.type === "content_block_delta" &&
          event.event.delta?.type === "text_delta" &&
          event.event.delta.text
        ) {
          this.emit({ type: "partial", text: event.event.delta.text });
        }
        break;

      case "result":
        this.summary = {
          isError: event.is_error,
          costUsd: event.total_cost_usd,
          numTurns: event.num_turns,
          sessionId: event.session_id,
          resultText: event.result,
        };
        break;
    }
  }

  getSummary(): SessionSummary {
    return this.summary;
  }
}
