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
              input: truncate(block.input, 300),
            });
          }
        }
        break;

      case "user":
        for (const block of event.message?.content ?? []) {
          if (block.type === "tool_result") {
            this.emit({
              type: "toolResult",
              isError: block.is_error ?? false,
              content: truncate(block.content, 300),
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
