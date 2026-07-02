import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  describeSchedule,
  formatResume,
  msUntilActive,
  parseActiveDays,
  parseTimeWindow,
} from "../src/active-hours.js";
import type { MonitorSchedule } from "../src/types.js";

const HOUR = 60 * 60_000;
const MINUTE = 60_000;

describe("parseTimeWindow", () => {
  it("parses HH:MM-HH:MM into minutes from midnight", () => {
    expect(parseTimeWindow("08:00-18:00")).toEqual({ startMinute: 480, endMinute: 1080 });
    expect(parseTimeWindow("8:30-9:05")).toEqual({ startMinute: 510, endMinute: 545 });
  });

  it("allows a window across midnight", () => {
    expect(parseTimeWindow("22:00-06:00")).toEqual({ startMinute: 1320, endMinute: 360 });
  });

  it("throws on an invalid format", () => {
    expect(() => parseTimeWindow("8-18")).toThrow(/format/);
    expect(() => parseTimeWindow("08:00–18:00")).toThrow(/format/);
  });

  it("throws out of the 00:00–23:59 range", () => {
    expect(() => parseTimeWindow("24:00-08:00")).toThrow(/range/);
    expect(() => parseTimeWindow("08:60-09:00")).toThrow(/range/);
  });

  it("throws when start equals end", () => {
    expect(() => parseTimeWindow("08:00-08:00")).toThrow(/identical/);
  });
});

describe("parseActiveDays", () => {
  it("parses single days into getDay indexes", () => {
    expect(parseActiveDays("mon,wed,fri")).toEqual([1, 3, 5]);
    expect(parseActiveDays("sun")).toEqual([0]);
  });

  it("expands ranges (Mon-first)", () => {
    expect(parseActiveDays("mon-fri")).toEqual([1, 2, 3, 4, 5]);
  });

  it("expands ranges that wrap across the week", () => {
    expect(parseActiveDays("fri-mon")).toEqual([0, 1, 5, 6]);
  });

  it("merges ranges and lists, dedupes and sorts", () => {
    expect(parseActiveDays("mon-fri,sun")).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("is resilient to letter case and spaces", () => {
    expect(parseActiveDays(" MON , Fri ")).toEqual([1, 5]);
  });

  it("throws on an unknown day", () => {
    expect(() => parseActiveDays("abc,xyz")).toThrow(/unknown day/);
  });
});

describe("buildSchedule", () => {
  it("returns null when both dimensions are empty", () => {
    expect(buildSchedule(undefined, undefined)).toBeNull();
    expect(buildSchedule("  ", "")).toBeNull();
  });

  it("hours only → all days", () => {
    expect(buildSchedule("08:00-18:00")).toEqual({
      startMinute: 480,
      endMinute: 1080,
      days: [0, 1, 2, 3, 4, 5, 6],
    });
  });

  it("days only → all day long", () => {
    expect(buildSchedule(undefined, "mon-fri")).toEqual({
      startMinute: 0,
      endMinute: 1440,
      days: [1, 2, 3, 4, 5],
    });
  });

  it("combines both dimensions", () => {
    expect(buildSchedule("08:00-18:00", "mon-fri")).toEqual({
      startMinute: 480,
      endMinute: 1080,
      days: [1, 2, 3, 4, 5],
    });
  });
});

describe("msUntilActive", () => {
  const workday: MonitorSchedule = {
    startMinute: 480,
    endMinute: 1080,
    days: [1, 2, 3, 4, 5],
  };

  it("returns 0 for null (24/7 mode)", () => {
    expect(msUntilActive(null, new Date("2026-07-01T03:00:00"))).toBe(0);
  });

  it("returns 0 inside the window", () => {
    expect(msUntilActive(workday, new Date("2026-07-01T09:00:00"))).toBe(0);
  });

  it("waits until the window opens on the same day", () => {
    expect(msUntilActive(workday, new Date("2026-07-01T06:30:00"))).toBe(90 * MINUTE);
  });

  it("after the window closes waits until the next working day", () => {
    expect(msUntilActive(workday, new Date("2026-07-01T19:00:00"))).toBe(13 * HOUR);
  });

  it("on Friday evening waits until Monday (weekend skipped)", () => {
    expect(msUntilActive(workday, new Date("2026-07-03T19:00:00"))).toBe(61 * HOUR);
  });

  it("accounts for the seconds and milliseconds of the current minute", () => {
    const now = new Date("2026-07-01T06:30:30.500");
    expect(msUntilActive(workday, now)).toBe(90 * MINUTE - 30_500);
  });

  it("handles a window across midnight", () => {
    const night: MonitorSchedule = {
      startMinute: 1320,
      endMinute: 360,
      days: [0, 1, 2, 3, 4, 5, 6],
    };
    expect(msUntilActive(night, new Date("2026-07-01T23:00:00"))).toBe(0);
    expect(msUntilActive(night, new Date("2026-07-01T03:00:00"))).toBe(0);
    expect(msUntilActive(night, new Date("2026-07-01T12:00:00"))).toBe(10 * HOUR);
  });

  it("for days only wakes at midnight of the nearest allowed day", () => {
    const daysOnly = buildSchedule(undefined, "mon-fri");
    expect(msUntilActive(daysOnly, new Date("2026-07-04T10:00:00"))).toBe(38 * HOUR);
  });
});

describe("formatResume", () => {
  it("formats a local date as YYYY-MM-DD HH:MM", () => {
    expect(formatResume(new Date("2026-07-06T08:05:00"))).toBe("2026-07-06 08:05");
  });
});

describe("describeSchedule", () => {
  it("describes 24/7 mode", () => {
    expect(describeSchedule(null)).toBe("24/7");
  });

  it("describes the window and working days", () => {
    expect(describeSchedule(buildSchedule("08:00-18:00", "mon-fri"))).toBe(
      "08:00-18:00 (Mon,Tue,Wed,Thu,Fri)",
    );
  });

  it("describes a full week as daily", () => {
    expect(describeSchedule(buildSchedule("08:00-18:00"))).toBe("08:00-18:00 (daily)");
  });
});
