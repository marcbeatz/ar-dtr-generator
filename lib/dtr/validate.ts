import { daysInMonth } from "../period";
import type { Period } from "./types";

export type FieldName = "name" | "month" | "year" | "cutoff" | "from";

export type Issue = { field: FieldName; message: string };

/** Name, month, cutoff, and year have to be present before a PDF can be downloaded. */
export function downloadIssues(name: string, period: Partial<Period> | undefined): Issue[] {
  const issues: Issue[] = [];
  if (!name.trim()) issues.push({ field: "name", message: "Enter a name to download." });

  const month = Number(period?.month);
  const year = Number(period?.year);
  const startDay = Number(period?.startDay);
  const endDay = Number(period?.endDay);
  const monthOk = Number.isInteger(month) && month >= 1 && month <= 12;
  const yearOk = Number.isInteger(year) && year >= 1990 && year <= 2100;

  if (!monthOk) issues.push({ field: "month", message: "Choose a month." });
  if (!yearOk) issues.push({ field: "year", message: "Enter a year." });
  if (!Number.isInteger(endDay) || endDay < 1 || endDay > 31) {
    issues.push({ field: "cutoff", message: "Enter a cutoff day." });
  } else if (monthOk && yearOk && endDay > daysInMonth(year, month)) {
    issues.push({ field: "cutoff", message: "That month does not include this cutoff." });
  }
  if (!Number.isInteger(startDay) || startDay < 1) {
    issues.push({ field: "from", message: "Enter the first day." });
  } else if (Number.isInteger(endDay) && endDay >= 1 && startDay > endDay) {
    issues.push({ field: "from", message: "The first day has to fall on or before the cutoff." });
  }
  return issues;
}
