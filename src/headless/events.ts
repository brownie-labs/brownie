export type HeadlessLogLevel = "info" | "warn" | "error";

export type HeadlessAgent = "monitor" | "executor" | "summarizer";

export interface HeadlessLogEvent {
  level: HeadlessLogLevel;
  event: string;
  agent?: HeadlessAgent | undefined;
  fields: Record<string, unknown>;
}

export type HeadlessLogEmitter = (event: HeadlessLogEvent) => void;

export function compactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) compacted[key] = value;
  }
  return compacted;
}
