import type { Period } from "./dtr/types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? "";
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parsePeriod(text: string): Period | null {
  const months = MONTHS.join("|");
  const range = new RegExp(
    `(${months})\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:[-–—]|to)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*[.,]?\\s*(20\\d{2})`,
    "i",
  );
  const ranged = text.match(range);
  if (ranged) {
    const month = MONTHS.findIndex((name) => name.toLowerCase() === ranged[1].toLowerCase()) + 1;
    const startDay = Number(ranged[2]);
    const endDay = Number(ranged[3]);
    const year = Number(ranged[4]);
    if (month && startDay >= 1 && endDay >= startDay && endDay <= 31) {
      return {
        label: `${monthName(month)} ${startDay}-${endDay}, ${year}`,
        month,
        year,
        startDay,
        endDay,
      };
    }
  }

  const full = new RegExp(`(${months})\\s+(20\\d{2})`, "i");
  const monthOnly = text.match(full);
  if (monthOnly) {
    const month = MONTHS.findIndex((name) => name.toLowerCase() === monthOnly[1].toLowerCase()) + 1;
    const year = Number(monthOnly[2]);
    const endDay = daysInMonth(year, month);
    return {
      label: `${monthName(month)} 1-${endDay}, ${year}`,
      month,
      year,
      startDay: 1,
      endDay,
    };
  }
  return null;
}

export function periodFromParts(month: number, year: number, startDay: number, endDay: number): Period {
  return {
    label: `${monthName(month)} ${startDay}-${endDay}, ${year}`,
    month,
    year,
    startDay,
    endDay,
  };
}
