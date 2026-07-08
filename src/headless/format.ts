import { formatDuration } from "../timing.js";
import type { HeadlessLogEvent } from "./events.js";

export const HEADLESS_LOG_FORMATS = ["pretty", "json"] as const;

export type HeadlessLogFormat = (typeof HEADLESS_LOG_FORMATS)[number];

export function parseHeadlessLogFormat(value: string): HeadlessLogFormat | null {
  return (HEADLESS_LOG_FORMATS as readonly string[]).includes(value)
    ? (value as HeadlessLogFormat)
    : null;
}

export function formatJsonLine(event: HeadlessLogEvent, at: Date): string {
  return JSON.stringify({
    ts: at.toISOString(),
    level: event.level,
    ...(event.agent === undefined ? {} : { agent: event.agent }),
    event: event.event,
    ...event.fields,
  });
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function renderValue(key: string, value: unknown): string {
  if (key === "durationMs" && typeof value === "number") return formatDuration(value);
  if (key === "costUsd" && typeof value === "number") return `$${value.toFixed(4)}`;
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
  return JSON.stringify(value);
}

function renderKey(key: string): string {
  if (key === "durationMs") return "duration";
  if (key === "costUsd") return "cost";
  return key;
}

export function formatPrettyLine(event: HeadlessLogEvent, at: Date): string {
  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`;
  const marker = event.level === "error" ? "✖ " : event.level === "warn" ? "⚠ " : "";
  const agent = event.agent === undefined ? "" : `[${event.agent}] `;
  const fields = Object.entries(event.fields)
    .map(([key, value]) => `${renderKey(key)}=${renderValue(key, value)}`)
    .join(" ");
  const suffix = fields === "" ? "" : ` ${fields}`;
  return `${time} ${agent}${marker}${event.event}${suffix}`;
}
