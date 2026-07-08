import type { HeadlessLogEmitter } from "./events.js";
import { formatJsonLine, formatPrettyLine, type HeadlessLogFormat } from "./format.js";

export interface HeadlessSinkOptions {
  format: HeadlessLogFormat;
  out: { write(chunk: string): unknown };
  now?: (() => Date) | undefined;
}

export function createHeadlessSink(options: HeadlessSinkOptions): HeadlessLogEmitter {
  const { format, out, now = () => new Date() } = options;
  const render = format === "json" ? formatJsonLine : formatPrettyLine;
  return (event) => {
    out.write(`${render(event, now())}\n`);
  };
}
