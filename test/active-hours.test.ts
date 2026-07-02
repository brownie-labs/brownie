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
  it("parsuje HH:MM-HH:MM na minuty od północy", () => {
    expect(parseTimeWindow("08:00-18:00")).toEqual({ startMinute: 480, endMinute: 1080 });
    expect(parseTimeWindow("8:30-9:05")).toEqual({ startMinute: 510, endMinute: 545 });
  });

  it("dopuszcza okno przez północ", () => {
    expect(parseTimeWindow("22:00-06:00")).toEqual({ startMinute: 1320, endMinute: 360 });
  });

  it("rzuca przy nieprawidłowym formacie", () => {
    expect(() => parseTimeWindow("8-18")).toThrow(/format/);
    expect(() => parseTimeWindow("08:00–18:00")).toThrow(/format/);
  });

  it("rzuca poza zakresem 00:00–23:59", () => {
    expect(() => parseTimeWindow("24:00-08:00")).toThrow(/zakres/);
    expect(() => parseTimeWindow("08:60-09:00")).toThrow(/zakres/);
  });

  it("rzuca gdy początek równy końcowi", () => {
    expect(() => parseTimeWindow("08:00-08:00")).toThrow(/identyczne/);
  });
});

describe("parseActiveDays", () => {
  it("parsuje pojedyncze dni na indeksy getDay", () => {
    expect(parseActiveDays("mon,wed,fri")).toEqual([1, 3, 5]);
    expect(parseActiveDays("sun")).toEqual([0]);
  });

  it("rozwija zakresy (Mon-first)", () => {
    expect(parseActiveDays("mon-fri")).toEqual([1, 2, 3, 4, 5]);
  });

  it("rozwija zakresy z zawijaniem przez tydzień", () => {
    expect(parseActiveDays("fri-mon")).toEqual([0, 1, 5, 6]);
  });

  it("łączy zakresy i listy, deduplikuje i sortuje", () => {
    expect(parseActiveDays("mon-fri,sun")).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("jest odporny na wielkość liter i spacje", () => {
    expect(parseActiveDays(" MON , Fri ")).toEqual([1, 5]);
  });

  it("rzuca przy nieznanym dniu", () => {
    expect(() => parseActiveDays("pon,wto")).toThrow(/nieznany dzień/);
  });
});

describe("buildSchedule", () => {
  it("zwraca null gdy oba wymiary puste", () => {
    expect(buildSchedule(undefined, undefined)).toBeNull();
    expect(buildSchedule("  ", "")).toBeNull();
  });

  it("same godziny → wszystkie dni", () => {
    expect(buildSchedule("08:00-18:00")).toEqual({
      startMinute: 480,
      endMinute: 1080,
      days: [0, 1, 2, 3, 4, 5, 6],
    });
  });

  it("same dni → cała doba", () => {
    expect(buildSchedule(undefined, "mon-fri")).toEqual({
      startMinute: 0,
      endMinute: 1440,
      days: [1, 2, 3, 4, 5],
    });
  });

  it("oba wymiary łączy", () => {
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

  it("zwraca 0 dla null (tryb 24/7)", () => {
    expect(msUntilActive(null, new Date("2026-07-01T03:00:00"))).toBe(0);
  });

  it("zwraca 0 w oknie", () => {
    expect(msUntilActive(workday, new Date("2026-07-01T09:00:00"))).toBe(0);
  });

  it("czeka do otwarcia okna tego samego dnia", () => {
    expect(msUntilActive(workday, new Date("2026-07-01T06:30:00"))).toBe(90 * MINUTE);
  });

  it("po zamknięciu okna czeka do następnego dnia roboczego", () => {
    expect(msUntilActive(workday, new Date("2026-07-01T19:00:00"))).toBe(13 * HOUR);
  });

  it("w piątek wieczorem czeka do poniedziałku (weekend pominięty)", () => {
    expect(msUntilActive(workday, new Date("2026-07-03T19:00:00"))).toBe(61 * HOUR);
  });

  it("uwzględnia sekundy i milisekundy bieżącej minuty", () => {
    const now = new Date("2026-07-01T06:30:30.500");
    expect(msUntilActive(workday, now)).toBe(90 * MINUTE - 30_500);
  });

  it("obsługuje okno przez północ", () => {
    const night: MonitorSchedule = {
      startMinute: 1320,
      endMinute: 360,
      days: [0, 1, 2, 3, 4, 5, 6],
    };
    expect(msUntilActive(night, new Date("2026-07-01T23:00:00"))).toBe(0);
    expect(msUntilActive(night, new Date("2026-07-01T03:00:00"))).toBe(0);
    expect(msUntilActive(night, new Date("2026-07-01T12:00:00"))).toBe(10 * HOUR);
  });

  it("dla samych dni budzi się o północy najbliższego dozwolonego dnia", () => {
    const daysOnly = buildSchedule(undefined, "mon-fri");
    expect(msUntilActive(daysOnly, new Date("2026-07-04T10:00:00"))).toBe(38 * HOUR);
  });
});

describe("formatResume", () => {
  it("formatuje datę lokalną jako YYYY-MM-DD HH:MM", () => {
    expect(formatResume(new Date("2026-07-06T08:05:00"))).toBe("2026-07-06 08:05");
  });
});

describe("describeSchedule", () => {
  it("opisuje tryb całodobowy", () => {
    expect(describeSchedule(null)).toBe("całą dobę");
  });

  it("opisuje okno i dni robocze", () => {
    expect(describeSchedule(buildSchedule("08:00-18:00", "mon-fri"))).toBe(
      "08:00-18:00 (pn,wt,śr,cz,pt)",
    );
  });

  it("opisuje pełny tydzień jako codziennie", () => {
    expect(describeSchedule(buildSchedule("08:00-18:00"))).toBe(
      "08:00-18:00 (codziennie)",
    );
  });
});
