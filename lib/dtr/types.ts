export type TimeField = "amIn" | "amOut" | "pmIn" | "pmOut";

export type DayRow = {
  day: number;
  label: string;
  amIn: string;
  amOut: string;
  pmIn: string;
  pmOut: string;
  /** Printed cells the reader could see but not transcribe. */
  keep: TimeField[];
};

export type Period = {
  label: string;
  month: number;
  year: number;
  startDay: number;
  endDay: number;
};

/** A label the user places across one or more days, such as a holiday. */
export type CustomRow = {
  from: number;
  to: number;
  label: string;
};

export const TIME_FIELDS: TimeField[] = ["amIn", "amOut", "pmIn", "pmOut"];

export function emptyDay(day: number): DayRow {
  return { day, label: "", amIn: "", amOut: "", pmIn: "", pmOut: "", keep: [] };
}
