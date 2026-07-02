import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "../src/session-events.js";
import { SessionLog, teeSession } from "../src/session-log.js";
import { createTempDir, removeTempDir } from "./helpers.js";

describe("SessionLog", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(() => removeTempDir(dir));

  it("writes a session to a file in the day folder, prefixed with the time", async () => {
    const at = new Date(2026, 6, 2, 9, 5, 7);
    const log = new SessionLog(dir, () => at);
    log.sink({ type: "init", model: "haiku", sessionId: "sess-1", toolCount: 3 });
    log.sink({ type: "text", text: "line one\nline two" });
    await log.close();

    const content = await readFile(
      join(dir, "2026-07-02", "09-05-07-sess-1.log"),
      "utf8",
    );
    expect(content).toBe(
      [
        "[09:05:07] init · model=haiku · session=sess-1 · tools: 3",
        "[09:05:07] line one",
        "[09:05:07] line two",
        "",
      ].join("\n"),
    );
  });

  it("each session (init) is a separate file", async () => {
    const now = vi
      .fn(() => new Date(2026, 6, 2, 10, 0, 5))
      .mockReturnValueOnce(new Date(2026, 6, 2, 10, 0, 0));
    const log = new SessionLog(dir, now);
    log.sink({ type: "init", model: "haiku", sessionId: "a", toolCount: 0 });
    log.sink({ type: "init", model: "opus", sessionId: "b", toolCount: 0 });
    await log.close();

    const files = (await readdir(join(dir, "2026-07-02"))).sort();
    expect(files).toEqual(["10-00-00-a.log", "10-00-05-b.log"]);
  });

  it("skips partial events", async () => {
    const at = new Date(2026, 6, 2, 10, 0, 0);
    const log = new SessionLog(dir, () => at);
    log.sink({ type: "init", model: "haiku", sessionId: "s", toolCount: 0 });
    log.sink({ type: "partial", text: "fragment" });
    log.sink({ type: "text", text: "full" });
    await log.close();

    const content = await readFile(join(dir, "2026-07-02", "10-00-00-s.log"), "utf8");
    expect(content).toBe(
      [
        "[10:00:00] init · model=haiku · session=s · tools: 0",
        "[10:00:00] full",
        "",
      ].join("\n"),
    );
  });

  it("events before init land in the fallback file", async () => {
    const at = new Date(2026, 6, 2, 11, 30, 0);
    const log = new SessionLog(dir, () => at);
    log.sink({ type: "stderr", line: "something went wrong" });
    await log.close();

    const files = await readdir(join(dir, "2026-07-02"));
    expect(files).toEqual(["11-30-00-unknown.log"]);
    const content = await readFile(
      join(dir, "2026-07-02", "11-30-00-unknown.log"),
      "utf8",
    );
    expect(content).toBe("[11:30:00] stderr: something went wrong\n");
  });

  it("pathFor returns the session log file path after init", async () => {
    const now = vi
      .fn(() => new Date(2026, 6, 2, 10, 0, 5))
      .mockReturnValueOnce(new Date(2026, 6, 2, 10, 0, 0));
    const log = new SessionLog(dir, now);

    expect(log.pathFor("a")).toBeUndefined();
    log.sink({ type: "init", model: "haiku", sessionId: "a", toolCount: 0 });
    log.sink({ type: "init", model: "opus", sessionId: "b", toolCount: 0 });
    await log.close();

    expect(log.pathFor("a")).toBe(join(dir, "2026-07-02", "10-00-00-a.log"));
    expect(log.pathFor("b")).toBe(join(dir, "2026-07-02", "10-00-05-b.log"));
    expect(log.pathFor("nonexistent")).toBeUndefined();
  });

  it("flush guarantees written lines are in the file without closing the log", async () => {
    const at = new Date(2026, 6, 2, 10, 0, 0);
    const log = new SessionLog(dir, () => at);
    log.sink({ type: "init", model: "haiku", sessionId: "s", toolCount: 0 });
    log.sink({ type: "text", text: "session result" });

    await log.flush();

    const path = log.pathFor("s");
    expect(path).toBeDefined();
    const content = await readFile(path ?? "", "utf8");
    expect(content).toContain("session result");

    log.sink({ type: "text", text: "continuation" });
    await log.close();
    expect(await readFile(path ?? "", "utf8")).toContain("continuation");
  });

  it("flush without an open session resolves immediately", async () => {
    const log = new SessionLog(dir);
    await expect(log.flush()).resolves.toBeUndefined();
  });

  it("organizes sessions into folders by start day", async () => {
    const now = vi
      .fn(() => new Date(2026, 6, 3, 0, 0, 1))
      .mockReturnValueOnce(new Date(2026, 6, 2, 23, 59, 59));
    const log = new SessionLog(dir, now);
    log.sink({ type: "init", model: "haiku", sessionId: "yesterday", toolCount: 0 });
    log.sink({ type: "init", model: "opus", sessionId: "today", toolCount: 0 });
    await log.close();

    expect((await readdir(dir)).sort()).toEqual(["2026-07-02", "2026-07-03"]);
    expect(await readdir(join(dir, "2026-07-02"))).toEqual(["23-59-59-yesterday.log"]);
    expect(await readdir(join(dir, "2026-07-03"))).toEqual(["00-00-01-today.log"]);
  });
});

describe("teeSession", () => {
  it("passes the event to the reporter and the extra sink", () => {
    const session = vi.fn();
    const extra = vi.fn();
    const reporter = { session, waiting: vi.fn() };
    const teed = teeSession(reporter, extra);
    const event: SessionEvent = { type: "text", text: "x" };

    teed.session(event);

    expect(session).toHaveBeenCalledWith(event);
    expect(extra).toHaveBeenCalledWith(event);
    expect(teed.waiting).toBe(reporter.waiting);
  });
});
