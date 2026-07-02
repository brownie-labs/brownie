import type { MonitorSchedule } from "./types.js";

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const FULL_DAY: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_TO_WEEKDAY: Record<(typeof DAY_ORDER)[number], number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 0,
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function isDayToken(value: string): value is (typeof DAY_ORDER)[number] {
  return (DAY_ORDER as readonly string[]).includes(value);
}

function parseMinuteOfDay(hours: string, minutes: string, raw: string): number {
  const h = Number(hours);
  const m = Number(minutes);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(
      `working hours out of range (00:00–23:59): "${raw}" — allowed HH:MM from 00:00 to 23:59`,
    );
  }
  return h * 60 + m;
}

export function parseTimeWindow(raw: string): { startMinute: number; endMinute: number } {
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (match === null) {
    throw new Error(
      `invalid working hours format (expected HH:MM-HH:MM, e.g. 08:00-18:00): "${raw}"`,
    );
  }
  const [, h1 = "", m1 = "", h2 = "", m2 = ""] = match;
  const startMinute = parseMinuteOfDay(h1, m1, raw);
  const endMinute = parseMinuteOfDay(h2, m2, raw);
  if (startMinute === endMinute) {
    throw new Error(
      `working hours start and end are identical ("${raw}") — leave empty to run the monitor 24/7`,
    );
  }
  return { startMinute, endMinute };
}

function expandDayRange(from: string, to: string, raw: string): number[] {
  if (!isDayToken(from) || !isDayToken(to)) {
    throw new Error(
      `unknown day in range "${from}-${to}" (allowed: ${DAY_ORDER.join(", ")}) in "${raw}"`,
    );
  }
  const start = DAY_ORDER.indexOf(from);
  const end = DAY_ORDER.indexOf(to);
  const span = ((end - start + 7) % 7) + 1;
  const days: number[] = [];
  for (let i = 0; i < span; i += 1) {
    const token = DAY_ORDER[(start + i) % 7];
    if (token !== undefined) days.push(DAY_TO_WEEKDAY[token]);
  }
  return days;
}

export function parseActiveDays(raw: string): number[] {
  const days = new Set<number>();
  for (const part of raw.split(",")) {
    const token = part.trim().toLowerCase();
    if (token === "") continue;
    if (token.includes("-")) {
      const [from = "", to = ""] = token.split("-");
      for (const day of expandDayRange(from, to, raw)) days.add(day);
    } else if (isDayToken(token)) {
      days.add(DAY_TO_WEEKDAY[token]);
    } else {
      throw new Error(
        `unknown day "${token}" (allowed: ${DAY_ORDER.join(", ")}) in "${raw}"`,
      );
    }
  }
  if (days.size === 0) {
    throw new Error(`no day recognized in "${raw}"`);
  }
  return [...days].sort((a, b) => a - b);
}

export function buildSchedule(
  hoursRaw?: string,
  daysRaw?: string,
): MonitorSchedule | null {
  const hours = hoursRaw?.trim() ?? "";
  const days = daysRaw?.trim() ?? "";
  if (hours === "" && days === "") return null;
  const window =
    hours === ""
      ? { startMinute: 0, endMinute: MINUTES_PER_DAY }
      : parseTimeWindow(hours);
  return {
    ...window,
    days: days === "" ? FULL_DAY : parseActiveDays(days),
  };
}

function isActive(schedule: MonitorSchedule, now: Date): boolean {
  if (!schedule.days.includes(now.getDay())) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  return schedule.startMinute < schedule.endMinute
    ? minute >= schedule.startMinute && minute < schedule.endMinute
    : minute >= schedule.startMinute || minute < schedule.endMinute;
}

export function msUntilActive(schedule: MonitorSchedule | null, now: Date): number {
  if (schedule === null || isActive(schedule, now)) return 0;
  const current = now.getDay() * MINUTES_PER_DAY + now.getHours() * 60 + now.getMinutes();
  const subMinute = now.getSeconds() * 1000 + now.getMilliseconds();
  const opens =
    schedule.startMinute < schedule.endMinute
      ? [schedule.startMinute]
      : [0, schedule.startMinute];
  let best = MINUTES_PER_WEEK;
  for (const day of schedule.days) {
    for (const open of opens) {
      const target = day * MINUTES_PER_DAY + open;
      const dist =
        (((target - current) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
      if (dist > 0 && dist < best) best = dist;
    }
  }
  return best * 60_000 - subMinute;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatResume(date: Date): string {
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${mo}-${d} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatMinuteOfDay(minute: number): string {
  return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
}

export function describeSchedule(schedule: MonitorSchedule | null): string {
  if (schedule === null) return "24/7";
  const fullDay = schedule.startMinute === 0 && schedule.endMinute === MINUTES_PER_DAY;
  const window = fullDay
    ? "24/7"
    : `${formatMinuteOfDay(schedule.startMinute)}-${formatMinuteOfDay(schedule.endMinute % MINUTES_PER_DAY)}`;
  const days =
    schedule.days.length === 7
      ? "daily"
      : schedule.days.map((day) => DAY_LABELS[day]).join(",");
  return `${window} (${days})`;
}
