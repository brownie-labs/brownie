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

  it("zapisuje sesję do pliku w folderze dnia, z prefiksem godziny", async () => {
    const at = new Date(2026, 6, 2, 9, 5, 7);
    const log = new SessionLog(dir, () => at);
    log.sink({ type: "init", model: "haiku", sessionId: "sess-1", toolCount: 3 });
    log.sink({ type: "text", text: "linia jeden\nlinia dwa" });
    await log.close();

    const content = await readFile(
      join(dir, "2026-07-02", "09-05-07-sess-1.log"),
      "utf8",
    );
    expect(content).toBe(
      [
        "[09:05:07] init · model=haiku · session=sess-1 · narzędzia: 3",
        "[09:05:07] linia jeden",
        "[09:05:07] linia dwa",
        "",
      ].join("\n"),
    );
  });

  it("każda sesja (init) to osobny plik", async () => {
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

  it("pomija zdarzenia partial", async () => {
    const at = new Date(2026, 6, 2, 10, 0, 0);
    const log = new SessionLog(dir, () => at);
    log.sink({ type: "init", model: "haiku", sessionId: "s", toolCount: 0 });
    log.sink({ type: "partial", text: "fragment" });
    log.sink({ type: "text", text: "pełny" });
    await log.close();

    const content = await readFile(join(dir, "2026-07-02", "10-00-00-s.log"), "utf8");
    expect(content).toBe(
      [
        "[10:00:00] init · model=haiku · session=s · narzędzia: 0",
        "[10:00:00] pełny",
        "",
      ].join("\n"),
    );
  });

  it("zdarzenia przed init trafiają do pliku awaryjnego", async () => {
    const at = new Date(2026, 6, 2, 11, 30, 0);
    const log = new SessionLog(dir, () => at);
    log.sink({ type: "stderr", line: "coś poszło nie tak" });
    await log.close();

    const files = await readdir(join(dir, "2026-07-02"));
    expect(files).toEqual(["11-30-00-nieznana.log"]);
    const content = await readFile(
      join(dir, "2026-07-02", "11-30-00-nieznana.log"),
      "utf8",
    );
    expect(content).toBe("[11:30:00] stderr: coś poszło nie tak\n");
  });

  it("porządkuje sesje w foldery według dnia startu", async () => {
    const now = vi
      .fn(() => new Date(2026, 6, 3, 0, 0, 1))
      .mockReturnValueOnce(new Date(2026, 6, 2, 23, 59, 59));
    const log = new SessionLog(dir, now);
    log.sink({ type: "init", model: "haiku", sessionId: "wczoraj", toolCount: 0 });
    log.sink({ type: "init", model: "opus", sessionId: "dzisiaj", toolCount: 0 });
    await log.close();

    expect((await readdir(dir)).sort()).toEqual(["2026-07-02", "2026-07-03"]);
    expect(await readdir(join(dir, "2026-07-02"))).toEqual(["23-59-59-wczoraj.log"]);
    expect(await readdir(join(dir, "2026-07-03"))).toEqual(["00-00-01-dzisiaj.log"]);
  });
});

describe("teeSession", () => {
  it("przekazuje zdarzenie do reportera i dodatkowego sinku", () => {
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
