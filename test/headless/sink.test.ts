import { describe, expect, it } from "vitest";
import { createHeadlessSink } from "../../src/headless/sink.js";

const AT = new Date("2026-07-08T09:05:03.000Z");

function collector() {
  const chunks: string[] = [];
  return {
    chunks,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
  };
}

describe("createHeadlessSink", () => {
  it("writes one newline-terminated JSON line per event", () => {
    const out = collector();
    const emit = createHeadlessSink({ format: "json", out, now: () => AT });

    emit({ level: "info", event: "worker.started", fields: { pid: 42 } });
    emit({ level: "warn", agent: "monitor", event: "monitor.limitWait", fields: {} });

    expect(out.chunks).toHaveLength(2);
    expect(out.chunks[0]?.endsWith("\n")).toBe(true);
    expect(JSON.parse(out.chunks[0] ?? "")).toMatchObject({
      ts: AT.toISOString(),
      event: "worker.started",
      pid: 42,
    });
  });

  it("writes pretty lines in pretty format", () => {
    const out = collector();
    const emit = createHeadlessSink({ format: "pretty", out, now: () => AT });

    emit({ level: "info", agent: "executor", event: "task.started", fields: {} });

    expect(out.chunks[0]).toContain("[executor] task.started");
    expect(out.chunks[0]?.endsWith("\n")).toBe(true);
  });

  it("defaults to the current time", () => {
    const out = collector();
    const emit = createHeadlessSink({ format: "json", out });

    emit({ level: "info", event: "worker.started", fields: {} });

    const parsed = JSON.parse(out.chunks[0] ?? "") as { ts: string };
    expect(Date.parse(parsed.ts)).not.toBeNaN();
  });
});
