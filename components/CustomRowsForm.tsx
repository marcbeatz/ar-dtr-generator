"use client";

import { useState } from "react";
import { holidaysFor } from "@/lib/holidays";
import type { CustomRow, Period } from "@/lib/dtr/types";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type Props = {
  period: Period;
  rows: CustomRow[];
  onChange: (next: CustomRow[]) => void;
};

function clampDay(value: number, period: Period) {
  const last = Math.min(period.endDay, 31);
  if (!Number.isFinite(value)) return period.startDay;
  return Math.min(Math.max(Math.round(value), period.startDay), last);
}

export function CustomRowsForm({ period, rows, onChange }: Props) {
  const [from, setFrom] = useState(period.startDay);
  const [to, setTo] = useState(period.startDay);
  const [label, setLabel] = useState("");
  const holidays = holidaysFor(period.year);
  const suggestions = holidays.filter(
    (holiday) =>
      holiday.month === period.month &&
      holiday.day >= period.startDay &&
      holiday.day <= Math.min(period.endDay, 31) &&
      !rows.some((row) => holiday.day >= row.from && holiday.day <= row.to),
  );
  const start = clampDay(from, period);
  const end = Math.max(start, clampDay(to, period));

  function add(row: CustomRow) {
    if (!row.label.trim()) return;
    onChange([...rows, { ...row, label: row.label.trim() }]);
  }

  function update(index: number, patch: Partial<CustomRow>) {
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="custom-rows">
      <h2>Holidays and labels</h2>
      <p className="note">Optional. A label replaces the times on those days and prints across the row.</p>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          add({ from: start, to: end, label });
          setLabel("");
        }}
      >
        <label className="field narrow">
          <span>From day</span>
          <input type="number" min={period.startDay} max={Math.min(period.endDay, 31)} value={from} onChange={(event) => setFrom(Number(event.target.value))} />
        </label>
        <label className="field narrow">
          <span>To day</span>
          <input type="number" min={period.startDay} max={Math.min(period.endDay, 31)} value={to} onChange={(event) => setTo(Number(event.target.value))} />
        </label>
        <label className="field">
          <span>Text on the row</span>
          <input list="holiday-names" placeholder="Bonifacio Day, Official business, P.N. 1447..." value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <button className="ghost" type="submit" disabled={!label.trim()}>Add row</button>
        <datalist id="holiday-names">
          {[...new Set(holidays.map((holiday) => holiday.name))].map((name) => <option key={name} value={name} />)}
        </datalist>
      </form>
      {suggestions.length ? (
        <div className="suggestions">
          <span className="meta-label">Holidays in this period</span>
          {suggestions.map((holiday) => (
            <button
              key={`${holiday.day}-${holiday.name}`}
              type="button"
              className="ghost"
              onClick={() => add({ from: holiday.day, to: holiday.day, label: holiday.name })}
            >
              + {holiday.name}, {MONTHS[holiday.month - 1]} {holiday.day}
            </button>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <table className="custom-list">
          <thead>
            <tr><th>From</th><th>To</th><th>Text</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const outside = row.to < period.startDay || row.from > period.endDay;
              return (
                <tr key={index} className={outside ? "outside" : ""}>
                  <td>
                    <input aria-label="From day" type="number" min={1} max={31} value={row.from} onChange={(event) => update(index, { from: Number(event.target.value), to: Math.max(row.to, Number(event.target.value)) })} />
                  </td>
                  <td>
                    <input aria-label="To day" type="number" min={1} max={31} value={row.to} onChange={(event) => update(index, { to: Math.max(row.from, Number(event.target.value)) })} />
                  </td>
                  <td>
                    <input aria-label="Row text" value={row.label} onChange={(event) => update(index, { label: event.target.value })} />
                    {outside ? <small>Outside the cutoff, not printed.</small> : null}
                  </td>
                  <td>
                    <button className="ghost" type="button" onClick={() => onChange(rows.filter((_, at) => at !== index))}>Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
