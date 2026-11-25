import { TIME_FIELDS, emptyDay, type CustomRow, type DayRow, type Period, type TimeField } from "./types";

const FALLBACK: Record<TimeField, string> = {
  amIn: "8:00",
  amOut: "12:00",
  pmIn: "1:00",
  pmOut: "5:00",
};

const EIGHT_HOURS = 8 * 60;

export function toMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 12 || minute > 59) return null;
  return hour * 60 + minute;
}

export function normalizeTime(raw: string): string {
  const compact = raw.replace(/[^\d:]/g, "");
  let hourText = "";
  let minuteText = "";
  const withColon = compact.match(/^(\d{1,2}):(\d{2})$/);
  const digits = compact.match(/^(\d{1,2})(\d{2})$/);
  if (withColon) {
    hourText = withColon[1];
    minuteText = withColon[2];
  } else if (digits && !compact.includes(":")) {
    hourText = digits[1];
    minuteText = digits[2];
  } else {
    return "";
  }
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (hour > 12 || minute > 59) return "";
  const pad = hourText.length === 2;
  const hourLabel = pad && hour < 10 ? `0${hour}` : String(hour);
  return `${hourLabel}:${String(minute).padStart(2, "0")}`;
}

function formatLike(minutes: number, samples: string[]): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const padded = samples.filter((sample) => /^0\d:/.test(sample)).length;
  const unpadded = samples.filter((sample) => /^\d:/.test(sample)).length;
  const hourLabel = hour < 10 && padded >= unpadded ? `0${hour}` : String(hour);
  return `${hourLabel}:${String(minute).padStart(2, "0")}`;
}

export function chooseTime(values: string[], fallback: string): string {
  const clean = values.map((value) => value.trim()).filter((value) => toMinutes(value) != null);
  if (!clean.length) return fallback;
  const counts = new Map<string, number>();
  for (const value of clean) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = clean[0];
  let count = 0;
  for (const [value, seen] of counts) {
    if (seen > count) {
      best = value;
      count = seen;
    }
  }
  if (count * 2 >= clean.length) return best;
  const minutes = clean.map((value) => toMinutes(value)!).sort((a, b) => a - b);
  const size = minutes.length;
  const median =
    size % 2 === 1
      ? minutes[(size - 1) / 2]
      : Math.round((minutes[size / 2 - 1] + minutes[size / 2]) / 2);
  return formatLike(median, clean);
}

function weekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function minutesFromMidnight(value: string, part: "am" | "pm"): number | null {
  const parsed = toMinutes(value);
  if (parsed == null) return null;
  const hour12 = Math.floor(parsed / 60);
  const minute = parsed % 60;
  if (hour12 === 12) return 12 * 60 + minute;
  return (part === "pm" ? hour12 + 12 : hour12) * 60 + minute;
}

function formatMinutes(total: number, pad: boolean): string {
  const minute = ((total % 60) + 60) % 60;
  let hour = Math.floor(total / 60) % 12;
  if (hour === 0) hour = 12;
  const label = pad && hour < 10 ? `0${hour}` : String(hour);
  return `${label}:${String(minute).padStart(2, "0")}`;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formSeed(period: Period, recognized: DayRow[]): number {
  let seed = (period.year * 100 + period.month) >>> 0;
  for (const day of recognized) {
    const token = `${day.day}|${day.amIn}|${day.amOut}|${day.pmIn}|${day.pmOut}|${day.label}`;
    for (const char of token) seed = (Math.imul(seed, 33) ^ char.charCodeAt(0)) >>> 0;
  }
  return seed || 1;
}

function arrivalMinutes(rand: () => number): number {
  return 6 * 60 + Math.floor(rand() * (2 * 60 + 1));
}

function departureMinutes(row: DayRow, rand: () => number): number {
  const start = minutesFromMidnight(row.amIn, "am") ?? 8 * 60;
  const midday = minutesFromMidnight(row.amOut, "am") ?? 12 * 60;
  const afternoon = minutesFromMidnight(row.pmIn, "pm") ?? 13 * 60;
  const morning = Math.max(0, midday - start);
  const earliest = afternoon + Math.max(0, EIGHT_HOURS - morning);
  const extra = Math.floor(rand() * 61);
  return Math.max(earliest, Math.min(earliest + extra, 20 * 60));
}

export function fillDays(recognized: DayRow[], period: Period): DayRow[] {
  const source = new Map(recognized.map((day) => [day.day, day]));
  const samples: Record<TimeField, string[]> = { amIn: [], amOut: [], pmIn: [], pmOut: [] };
  for (let day = period.startDay; day <= period.endDay; day += 1) {
    const row = source.get(day) ?? emptyDay(day);
    if (row.label) continue;
    for (const field of TIME_FIELDS) {
      if (row[field]) samples[field].push(row[field]);
    }
  }
  const lunchOut = chooseTime(samples.amOut, FALLBACK.amOut);
  const lunchIn = chooseTime(samples.pmIn, FALLBACK.pmIn);
  const seed = formSeed(period, recognized);

  const lastDay = Math.min(31, Math.max(30, ...recognized.map((row) => row.day), 0));
  const days: DayRow[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const row = source.get(day) ?? emptyDay(day);
    if (day < period.startDay || day > period.endDay) {
      days.push(row);
      continue;
    }
    if (row.label) {
      days.push({ ...row, keep: [] });
      continue;
    }
    const hasTime = TIME_FIELDS.some((field) => row[field] || row.keep.includes(field));
    if (!hasTime) {
      const dow = weekday(period.year, period.month, day);
      if (dow === 6) {
        days.push({ ...emptyDay(day), label: "Saturday" });
        continue;
      }
      if (dow === 0) {
        days.push({ ...emptyDay(day), label: "Sunday" });
        continue;
      }
    }
    const next = { ...row, keep: [...row.keep] };
    const rand = mulberry32(seed ^ (day * 997));
    if (!next.amOut && !next.keep.includes("amOut")) next.amOut = lunchOut;
    if (!next.pmIn && !next.keep.includes("pmIn")) next.pmIn = lunchIn;
    if (!next.amIn && !next.keep.includes("amIn")) next.amIn = formatMinutes(arrivalMinutes(rand), true);
    if (!next.pmOut && !next.keep.includes("pmOut")) next.pmOut = formatMinutes(departureMinutes(next, rand), true);
    days.push(next);
  }
  return days;
}

function labelFor(rows: CustomRow[], day: number, period: Period) {
  if (day < period.startDay || day > period.endDay) return null;
  const match = rows.filter((row) => row.label.trim() && day >= row.from && day <= row.to).pop();
  return match ? match.label.trim() : null;
}

/**
 * Moves `days` from the `previous` custom rows to the `next` ones. Days that leave
 * every custom row go back to `base`; other days keep their edits.
 */
export function applyRows(days: DayRow[], base: DayRow[], period: Period, previous: CustomRow[], next: CustomRow[]): DayRow[] {
  const original = new Map(base.map((day) => [day.day, day]));
  return days.map((row) => {
    const label = labelFor(next, row.day, period);
    if (label) return row.label === label ? row : { ...emptyDay(row.day), label };
    if (labelFor(previous, row.day, period)) return original.get(row.day) ?? row;
    return row;
  });
}
