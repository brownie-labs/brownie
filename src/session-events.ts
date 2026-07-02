export type SessionEvent =
  | { type: "init"; model: string; sessionId: string; toolCount: number }
  | { type: "text"; text: string }
  | { type: "toolUse"; name: string; input: string }
  | { type: "toolResult"; isError: boolean; content: string }
  | { type: "partial"; text: string }
  | { type: "raw"; line: string }
  | { type: "stderr"; line: string }
  | { type: "killing"; reason: "timeout" | "abort" }
  | { type: "procError"; message: string };

export type SessionEventSink = (event: SessionEvent) => void;

export function truncate(value: unknown, max = 500): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export function formatSessionEvent(
  event: Exclude<SessionEvent, { type: "partial" }>,
): string {
  switch (event.type) {
    case "init":
      return `init · model=${event.model} · session=${event.sessionId} · tools: ${event.toolCount}`;
    case "text":
      return event.text;
    case "toolUse":
      return `🔧 ${event.name} ${event.input}`;
    case "toolResult":
      return `${event.isError ? "⚠ result(error)" : "↳ result"} ${event.content}`;
    case "raw":
      return `(non-JSON) ${event.line}`;
    case "stderr":
      return `stderr: ${event.line}`;
    case "killing":
      return `⏹ Stopping session (${event.reason})…`;
    case "procError":
      return `✖ ${event.message}`;
  }
}
