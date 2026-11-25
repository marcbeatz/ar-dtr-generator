"use client";

import { useEffect, useMemo, useState } from "react";
import { CustomRowsForm } from "./CustomRowsForm";
import { applyRows, fillDays } from "@/lib/dtr/fill";
import { TIME_FIELDS, type CustomRow, type DayRow, type Period, type TimeField } from "@/lib/dtr/types";
import { downloadIssues, type FieldName } from "@/lib/dtr/validate";
import { daysInMonth, periodFromParts } from "@/lib/period";

type Payload = {
  name: string;
  period: Period;
  recognized: DayRow[];
  days: DayRow[];
  rows: CustomRow[];
};

const DEFAULT_HEAD_OFFICER = "SIMON, AHMED GENESIS F.";
const HEAD_OFFICER_KEY = "dtr.headOfficer";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function startingPeriod(): Period {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (now.getDate() <= 15) return periodFromParts(month, year, 1, 15);
  return periodFromParts(month, year, 16, daysInMonth(year, month));
}

function blankDraft(period: Period): Payload {
  return { name: "", period, recognized: [], days: fillDays([], period), rows: [] };
}

function numberOrBlank(value: number) {
  return Number.isFinite(value) ? value : "";
}

export function DtrStudio() {
  const [data, setData] = useState<Payload>(() => blankDraft(startingPeriod()));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [headOfficer, setHeadOfficer] = useState(DEFAULT_HEAD_OFFICER);

  useEffect(() => {
    const saved = window.localStorage.getItem(HEAD_OFFICER_KEY);
    if (saved != null) setHeadOfficer(saved);
  }, []);

  function updateHeadOfficer(value: string) {
    setHeadOfficer(value);
    window.localStorage.setItem(HEAD_OFFICER_KEY, value);
  }

  const issues = useMemo(() => downloadIssues(data.name, data.period), [data.name, data.period]);
  const blocked = issues[0]?.message ?? "";
  const invalid = (field: FieldName) => issues.some((issue) => issue.field === field && field !== "name");
  const periodReady = downloadIssues("Name", data.period).length === 0;

  async function onFile(next: File) {
    setReading(true);
    setError("");
    const body = new FormData();
    body.set("file", next);
    const response = await fetch("/api/dtr/parse", { method: "POST", body });
    const json = await response.json();
    setReading(false);
    if (!response.ok) {
      setError(json.error ?? "Could not read that file.");
      return;
    }
    setFile(next);
    setData({ name: json.name, period: json.period, recognized: json.recognized, days: json.days, rows: [] });
  }

  function updatePeriod(patch: Partial<Period>) {
    const next = { ...data.period, ...patch };
    const monthKnown = Number.isInteger(next.month) && next.month >= 1 && next.month <= 12;
    const yearKnown = Number.isInteger(next.year) && next.year >= 1990 && next.year <= 2100;
    if ((patch.month != null || patch.year != null) && monthKnown && yearKnown) {
      const last = daysInMonth(next.year, next.month);
      if (Number.isInteger(next.endDay) && next.endDay > last) next.endDay = last;
      if (Number.isInteger(next.startDay) && Number.isInteger(next.endDay) && next.startDay > next.endDay) next.startDay = 1;
    }
    if (downloadIssues("Name", next).length > 0) {
      setData({ ...data, period: next });
      return;
    }
    const period = periodFromParts(next.month, next.year, next.startDay, next.endDay);
    const base = fillDays(data.recognized, period);
    setData({ ...data, period, days: applyRows(base, base, period, [], data.rows) });
  }

  function updateRows(rows: CustomRow[]) {
    const base = fillDays(data.recognized, data.period);
    setData({ ...data, rows, days: applyRows(data.days, base, data.period, data.rows, rows) });
  }

  function updateDay(day: number, field: TimeField | "label", value: string) {
    setData({
      ...data,
      days: data.days.map((row) => (row.day === day ? { ...row, [field]: value } : row)),
    });
  }

  const recognized = useMemo(() => new Map(data.recognized.map((day) => [day.day, day])), [data.recognized]);
  const imported = data.recognized.some((day) => day.label || day.keep.length || TIME_FIELDS.some((field) => day[field]));

  async function download() {
    if (blocked || busy) return;
    setBusy(true);
    setError("");
    const body = new FormData();
    if (file) body.set("file", file);
    body.set("payload", JSON.stringify({ ...data, name: data.name.trim(), headOfficer }));
    const response = await fetch("/api/dtr/pdf", { method: "POST", body });
    setBusy(false);
    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      setError(json.error ?? "Could not build the PDF.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const header = response.headers.get("Content-Disposition") ?? "";
    const match = header.match(/filename\*=UTF-8''([^;]+)/);
    link.href = url;
    link.download = match ? decodeURIComponent(match[1]) : "DTR.pdf";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="studio">
      <h1 className="page-title">Daily Time Record</h1>
      <p className="lede">Enter a name, month, cutoff, and year. The PDF can be a new form, or the file you upload.</p>

      <div className="upload-line">
        <label className="ghost file-btn">
          {reading ? "Reading…" : file ? "Replace file" : "Upload a DTR"}
          <input
            type="file"
            accept="application/pdf,image/*"
            disabled={reading || busy}
            onChange={(event) => {
              const next = event.target.files?.[0];
              event.target.value = "";
              if (next) onFile(next);
            }}
          />
        </label>
        {file ? <span className="file-name">{file.name}</span> : <p>Optional. A PDF or photo fills the name, the period, and any times already printed.</p>}
        {file ? (
          <button className="ghost" type="button" onClick={() => setFile(null)}>
            Clear file
          </button>
        ) : null}
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="sheet">
        <div className="section record-grid">
          <div>
            <h2>Record</h2>
            <label className="field">
              <span className="req">Name</span>
              <input autoFocus autoComplete="name" value={data.name} onChange={(event) => setData({ ...data, name: event.target.value })} />
            </label>
            <div className="period-fields">
              <label className="field">
                <span className="req">Month</span>
                <select value={data.period.month} onChange={(event) => updatePeriod({ month: Number(event.target.value) })}>
                  {MONTHS.map((month, index) => (
                    <option key={month} value={index + 1}>
                      {month}
                    </option>
                  ))}
                </select>
              </label>
              <label className={invalid("year") ? "field invalid" : "field"}>
                <span className="req">Year</span>
                <input type="number" inputMode="numeric" min={1990} max={2100} value={numberOrBlank(data.period.year)} onChange={(event) => updatePeriod({ year: event.target.value === "" ? Number.NaN : Number(event.target.value) })} />
              </label>
              <label className={invalid("from") ? "field invalid" : "field"}>
                <span>From</span>
                <input type="number" inputMode="numeric" min={1} max={31} value={numberOrBlank(data.period.startDay)} onChange={(event) => updatePeriod({ startDay: event.target.value === "" ? Number.NaN : Number(event.target.value) })} />
              </label>
              <label className={invalid("cutoff") ? "field invalid" : "field"}>
                <span className="req">Cutoff</span>
                <input type="number" inputMode="numeric" min={1} max={31} value={numberOrBlank(data.period.endDay)} onChange={(event) => updatePeriod({ endDay: event.target.value === "" ? Number.NaN : Number(event.target.value) })} />
              </label>
            </div>
            {periodReady ? <p className="period-line">{data.period.label}</p> : null}
          </div>

          <div>
            <h2>Head officer</h2>
            <div className="officer">
              <label className="field">
                <span>Printed name</span>
                <input value={headOfficer} placeholder={DEFAULT_HEAD_OFFICER} onChange={(event) => updateHeadOfficer(event.target.value)} />
              </label>
              <button className="ghost" type="button" disabled={headOfficer === DEFAULT_HEAD_OFFICER} onClick={() => updateHeadOfficer(DEFAULT_HEAD_OFFICER)}>
                Reset
              </button>
            </div>
            <p className="hint">Printed on both copies, above the signature line.</p>
          </div>
        </div>

        <div className="section">
          <CustomRowsForm key={`${data.period.month}-${data.period.startDay}`} period={data.period} rows={data.rows} onChange={updateRows} />
        </div>

        <div className="section">
          <h2>Daily times</h2>
          <p className="note">Arrivals fall between 6:00 and 8:00 a.m., and each weekday covers at least eight hours. You can edit any open cell.</p>
          <div className="grid-wrap">
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>A.M. arrival</th>
                  <th>A.M. departure</th>
                  <th>P.M. arrival</th>
                  <th>P.M. departure</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((day) => {
                  const original = recognized.get(day.day);
                  const outside = day.day < data.period.startDay || day.day > data.period.endDay;
                  const added = imported && !outside && TIME_FIELDS.some((field) => !original?.[field] && day[field] && !original?.keep.includes(field));
                  return (
                    <tr key={day.day} className={outside ? "outside" : added || (imported && day.label && !original?.label) ? "proposed" : ""}>
                      <td>{day.day}</td>
                      {day.label ? (
                        <td colSpan={4}>
                          <input aria-label={`Day ${day.day} label`} value={day.label} disabled={outside} onChange={(event) => updateDay(day.day, "label", event.target.value)} />
                        </td>
                      ) : (
                        TIME_FIELDS.map((field) => (
                          <td key={field}>
                            <input
                              aria-label={`Day ${day.day} ${field}`}
                              value={day[field]}
                              disabled={outside || original?.keep.includes(field)}
                              placeholder={original?.keep.includes(field) ? "as printed" : ""}
                              onChange={(event) => updateDay(day.day, field, event.target.value)}
                            />
                          </td>
                        ))
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="download-bar">
          <button className={busy ? "primary is-busy" : "primary"} type="button" disabled={Boolean(blocked) || busy || reading} onClick={download}>
            {busy ? "Preparing PDF…" : "Download PDF"}
          </button>
          <p id="dtr-issue" className="note">
            {blocked || (file ? "The uploaded page is filled and downloaded." : "A new form is created, with both copies filled the same way.")}
          </p>
        </div>
      </div>
    </main>
  );
}
