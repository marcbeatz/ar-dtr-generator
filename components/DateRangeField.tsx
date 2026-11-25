"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { daysInMonth, monthName } from "@/lib/period";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

export type DateRange = {
  year: number;
  month: number;
  startDay: number;
  endDay: number;
};

type Props = {
  label: string;
  required?: boolean;
  compact?: boolean;
  className?: string;
  year: number;
  month: number;
  startDay: number;
  endDay: number;
  minDay?: number;
  maxDay?: number;
  /** When set, the arrows move between months. A record still covers one month. */
  navigateMonths?: boolean;
  onChange: (next: DateRange) => void;
};

function cellsFor(year: number, month: number) {
  const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const total = daysInMonth(year, month);
  const cells: Array<number | null> = [];
  for (let index = 0; index < leading; index += 1) cells.push(null);
  for (let day = 1; day <= total; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function rangeText(month: number, year: number, start: number, end: number, compact: boolean) {
  const name = compact ? monthName(month).slice(0, 3) : monthName(month);
  const days = start === end ? `${start}` : `${start} – ${end}`;
  return compact ? `${name} ${days}` : `${name} ${days}, ${year}`;
}

export function DateRangeField({
  label,
  required,
  compact,
  className,
  year,
  month,
  startDay,
  endDay,
  minDay = 1,
  maxDay,
  navigateMonths,
  onChange,
}: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState({ year, month });
  const [pending, setPending] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const start = Number.isFinite(startDay) ? startDay : 1;
  const end = Number.isFinite(endDay) ? endDay : start;
  const committedStart = Math.min(start, end);
  const committedEnd = Math.max(start, end);
  const text = rangeText(month, year, committedStart, committedEnd, Boolean(compact));

  const dismiss = useCallback(() => {
    setPending(null);
    setHover(null);
    setOpen(false);
  }, []);

  useEffect(() => {
    setCursor((current) => (current.year === year && current.month === month ? current : { year, month }));
  }, [year, month]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) dismiss();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    const narrow = window.matchMedia("(max-width: 700px)").matches;
    const previous = document.body.style.overflow;
    if (narrow) document.body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.body.style.overflow = previous;
    };
  }, [open, dismiss]);

  const last = daysInMonth(cursor.year, cursor.month);
  const floor = navigateMonths ? 1 : Math.min(Math.max(minDay, 1), last);
  const ceiling = navigateMonths ? last : Math.min(Math.max(maxDay ?? last, floor), last);
  const sameMonth = cursor.year === year && cursor.month === month;
  const previewEnd = pending == null ? null : hover ?? pending;
  const shownStart = pending != null ? Math.min(pending, previewEnd ?? pending) : sameMonth ? committedStart : null;
  const shownEnd = pending != null ? Math.max(pending, previewEnd ?? pending) : sameMonth ? committedEnd : null;
  const now = new Date();
  const today = now.getFullYear() === cursor.year && now.getMonth() + 1 === cursor.month ? now.getDate() : 0;
  const atMin = cursor.year === MIN_YEAR && cursor.month === 1;
  const atMax = cursor.year === MAX_YEAR && cursor.month === 12;

  function toggle() {
    setPending(null);
    setHover(null);
    setCursor({ year, month });
    setOpen((value) => !value);
  }

  function shift(delta: number) {
    const index = cursor.year * 12 + (cursor.month - 1) + delta;
    const nextYear = Math.floor(index / 12);
    const nextMonth = (index % 12) + 1;
    if (nextYear < MIN_YEAR || nextYear > MAX_YEAR) return;
    setPending(null);
    setHover(null);
    setCursor({ year: nextYear, month: nextMonth });
  }

  function commit(nextYear: number, nextMonth: number, nextStart: number, nextEnd: number) {
    setPending(null);
    setHover(null);
    setOpen(false);
    if (nextYear === year && nextMonth === month && nextStart === committedStart && nextEnd === committedEnd) return;
    onChange({ year: nextYear, month: nextMonth, startDay: nextStart, endDay: nextEnd });
  }

  function pick(day: number) {
    if (pending == null) {
      setPending(day);
      setHover(day);
      return;
    }
    commit(cursor.year, cursor.month, Math.min(pending, day), Math.max(pending, day));
  }

  const presets = navigateMonths
    ? [
        { label: "1–15", startDay: 1, endDay: Math.min(15, last) },
        { label: `16–${last}`, startDay: 16, endDay: last },
        { label: "Full month", startDay: 1, endDay: last },
      ]
    : [];

  const status =
    pending == null
      ? `${committedEnd - committedStart + 1} days selected`
      : `${monthName(cursor.month)} ${pending}. Choose the last day.`;

  return (
    <div className={["range-field", open ? "is-open" : "", className ?? ""].filter(Boolean).join(" ")} ref={rootRef}>
      <button
        type="button"
        className={compact ? "range-trigger compact" : "range-trigger"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={toggle}
      >
        <span className={required ? "range-kicker req" : "range-kicker"}>{label}</span>
        <strong>{text}</strong>
        <span className="range-action">{open ? "Close" : "Change"}</span>
      </button>
      {open ? (
        <>
          <button type="button" className="range-backdrop" aria-label="Close calendar" onClick={dismiss} />
          <div
            id={panelId}
            className="range-panel"
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            ref={panelRef}
            onMouseLeave={() => setHover(null)}
          >
            <div className="range-top">
              <p className="range-status" aria-live="polite">
                {status}
              </p>
              <button type="button" className="range-close" onClick={dismiss}>
                Close
              </button>
            </div>
            <div className="range-nav">
              {navigateMonths ? (
                <button type="button" aria-label="Previous month" disabled={atMin} onClick={() => shift(-1)}>
                  ‹
                </button>
              ) : (
                <span />
              )}
              <strong>
                {monthName(cursor.month)} {cursor.year}
              </strong>
              {navigateMonths ? (
                <button type="button" aria-label="Next month" disabled={atMax} onClick={() => shift(1)}>
                  ›
                </button>
              ) : (
                <span />
              )}
            </div>
            <div className="range-week" aria-hidden="true">
              {WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="range-grid">
              {cellsFor(cursor.year, cursor.month).map((day, index) => {
                if (day == null) return <span key={`empty-${index}`} />;
                const selectable = day >= floor && day <= ceiling;
                const lone = shownStart != null && shownStart === shownEnd && day === shownStart;
                const edge = shownStart != null && shownStart !== shownEnd && (day === shownStart || day === shownEnd);
                const inside = shownStart != null && shownEnd != null && day > shownStart && day < shownEnd;
                const className = [lone || edge ? "is-edge" : "", !lone && (edge || inside) ? "in-range" : "", day === today ? "is-today" : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    key={day}
                    type="button"
                    className={className}
                    disabled={!selectable}
                    aria-pressed={lone || edge}
                    aria-label={`${monthName(cursor.month)} ${day}, ${cursor.year}`}
                    onMouseEnter={() => {
                      if (pending != null) setHover(day);
                    }}
                    onClick={() => pick(day)}
                  >
                    <span>{day}</span>
                  </button>
                );
              })}
            </div>
            {presets.length ? (
              <div className="range-presets">
                {presets.map((preset) => {
                  const selected = pending == null && sameMonth && preset.startDay === committedStart && preset.endDay === committedEnd;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      className={selected ? "is-selected" : ""}
                      aria-pressed={selected}
                      onClick={() => commit(cursor.year, cursor.month, preset.startDay, preset.endDay)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <p className="range-hint">
              {navigateMonths
                ? "Choose the first day, then the last. Tap a day twice for a single day. A record stays inside one month."
                : "Choose the first day, then the last. Tap a day twice for a single day."}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
