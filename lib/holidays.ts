export type Holiday = { month: number; day: number; name: string };

const FIXED: Holiday[] = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 2, day: 25, name: "EDSA People Power Revolution Anniversary" },
  { month: 4, day: 9, name: "Araw ng Kagitingan" },
  { month: 5, day: 1, name: "Labor Day" },
  { month: 6, day: 12, name: "Independence Day" },
  { month: 8, day: 21, name: "Ninoy Aquino Day" },
  { month: 11, day: 1, name: "All Saints' Day" },
  { month: 11, day: 2, name: "All Souls' Day" },
  { month: 11, day: 30, name: "Bonifacio Day" },
  { month: 12, day: 8, name: "Feast of the Immaculate Conception" },
  { month: 12, day: 24, name: "Christmas Eve" },
  { month: 12, day: 25, name: "Christmas Day" },
  { month: 12, day: 30, name: "Rizal Day" },
  { month: 12, day: 31, name: "Last Day of the Year" },
];

function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function shift(year: number, month: number, day: number, delta: number): Holiday & { year: number } {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + delta);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    name: "",
  };
}

function lastMondayOfAugust(year: number): number {
  const date = new Date(Date.UTC(year, 8, 0));
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() - 1);
  return date.getUTCDate();
}

export function holidaysFor(year: number): Holiday[] {
  const easter = easterSunday(year);
  const thursday = shift(year, easter.month, easter.day, -3);
  const friday = shift(year, easter.month, easter.day, -2);
  return [
    ...FIXED,
    { month: thursday.month, day: thursday.day, name: "Maundy Thursday" },
    { month: friday.month, day: friday.day, name: "Good Friday" },
    { month: 8, day: lastMondayOfAugust(year), name: "National Heroes Day" },
  ];
}

export function canonicalLabel(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9'.,/ -]/g, " ").replace(/\s+/g, " ").trim();
  const key = cleaned.toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return "";
  if (key === "saturday" || key === "sat") return "Saturday";
  if (key === "sunday" || key === "sun") return "Sunday";
  if (key === "dayoff") return "Dayoff";
  for (const holiday of FIXED) {
    if (holiday.name.toLowerCase().replace(/[^a-z]/g, "") === key) return holiday.name;
  }
  for (const name of ["Maundy Thursday", "Good Friday", "National Heroes Day"]) {
    if (name.toLowerCase().replace(/[^a-z]/g, "") === key) return name;
  }
  if (cleaned.length < 4) return "";
  if (/\d/.test(cleaned)) return cleaned;
  return cleaned.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
