import type { ConsolaInstance } from "consola";
import type { SessionResult } from "./types.js";

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

function truncate(value: unknown, max = 500): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export class StreamRenderer {
  private partialOpen = false;
  private summary: Omit<SessionResult, "durationMs" | "ok"> & { is_error?: boolean } = {};

  constructor(
    private readonly log: ConsolaInstance,
    private readonly streamPartial: boolean,
  ) {}

  handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch {
      this.log.debug(`(nie-JSON) ${truncate(trimmed)}`);
      return;
    }
    this.handleEvent(event);
  }

  private endPartial(): void {
    if (this.partialOpen) {
      process.stdout.write("\n");
      this.partialOpen = false;
    }
  }

  private handleEvent(event: StreamEvent): void {
    switch (event.type) {
      case "system":
        if (event.subtype === "init") {
          this.endPartial();
          this.log.info(
            `init · model=${event.model ?? "?"} · session=${event.session_id ?? "?"} · narzędzia: ${event.tools?.length ?? 0}`,
          );
        }
        break;

      case "assistant":
        this.endPartial();
        for (const block of event.message?.content ?? []) {
          if (block.type === "text" && block.text?.trim()) {
            this.log.log(block.text.trim());
          } else if (block.type === "tool_use") {
            this.log.info(`🔧 ${block.name} ${truncate(block.input, 300)}`);
          }
        }
        break;

      case "user":
        this.endPartial();
        for (const block of event.message?.content ?? []) {
          if (block.type === "tool_result") {
            const prefix = block.is_error ? "⚠ wynik(błąd)" : "↳ wynik";
            this.log.debug(`${prefix} ${truncate(block.content, 300)}`);
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
          process.stdout.write(event.event.delta.text);
          this.partialOpen = true;
        }
        break;

      case "result":
        this.endPartial();
        this.summary = {
          is_error: event.is_error,
          costUsd: event.total_cost_usd,
          numTurns: event.num_turns,
          sessionId: event.session_id,
        };
        break;
    }
  }

  getSummary(): Omit<SessionResult, "durationMs" | "ok"> & { is_error?: boolean } {
    this.endPartial();
    return this.summary;
  }
}
