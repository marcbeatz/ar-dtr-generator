import type { Canvas } from "@napi-rs/canvas";
import { canonicalLabel } from "../holidays";
import { PSM } from "tesseract.js";
import { canvasPng, inkRatio, isDark, readPixels, recognize, renderPdfPage, loadRaster, type Rgba } from "../extract";
import { parsePeriod } from "../period";
import { normalizeTime } from "./fill";
import { TIME_FIELDS, emptyDay, type DayRow, type Period, type TimeField } from "./types";

const SCALE = 3;
const INK = 0.03;

export type TableGeometry = {
  cols: number[];
  rows: number[];
};

export type DtrRead = {
  name: string;
  period: Period;
  recognized: DayRow[];
  warnings: string[];
};

type Prepared = {
  canvas: Canvas;
  image: Rgba;
  scale: number;
  pageWidth: number;
  pageHeight: number;
};

function clusters(values: number[], gap: number) {
  const groups: { start: number; end: number }[] = [];
  for (const value of values) {
    const last = groups[groups.length - 1];
    if (!last || value - last.end > gap) groups.push({ start: value, end: value });
    else last.end = value;
  }
  return groups.map((group) => Math.round((group.start + group.end) / 2));
}

function horizontalLines(image: Rgba, x0: number, x1: number) {
  const minRun = (x1 - x0) * 0.55;
  const found: number[] = [];
  for (let y = 0; y < image.height; y += 1) {
    let run = 0;
    let max = 0;
    for (let x = x0; x < x1; x += 1) {
      if (isDark(image, x, y)) {
        run += 1;
        if (run > max) max = run;
      } else run = 0;
    }
    if (max > minRun) found.push(y);
  }
  return clusters(found, 4);
}

function verticalLines(image: Rgba) {
  const top = Math.floor(image.height * 0.28);
  const bottom = Math.floor(image.height * 0.78);
  const span = bottom - top;
  const found: number[] = [];
  for (let x = 0; x < image.width; x += 1) {
    let count = 0;
    let run = 0;
    let max = 0;
    for (let y = top; y < bottom; y += 1) {
      if (isDark(image, x, y)) {
        count += 1;
        run += 1;
        if (run > max) max = run;
      } else run = 0;
    }
    if (max > span * 0.35 || count > span * 0.45) found.push(x);
  }
  return clusters(found, 4);
}

function groupTables(lines: number[]) {
  if (lines.length < 6) return [];
  const gaps = lines.slice(1).map((line, index) => line - lines[index]);
  const typical = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 40;
  const tables: number[][] = [];
  let current = [lines[0]];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] - lines[index - 1] > typical * 1.2) {
      if (current.length >= 6) tables.push(current.slice(0, 8));
      current = [];
    }
    current.push(lines[index]);
  }
  if (current.length >= 6) tables.push(current.slice(0, 8));
  return tables;
}

function dayRows(image: Rgba, cols: number[]) {
  const lines = horizontalLines(image, cols[0] - 2, cols[cols.length - 1] + 2);
  const gaps = lines.slice(1).map((line, index) => line - lines[index]);
  const small = gaps.filter((gap) => gap > 18 && gap < 55);
  if (!small.length) return [];
  const median = [...small].sort((a, b) => a - b)[Math.floor(small.length / 2)];
  let bestStart = 0;
  let bestLength = 0;
  let runStart = 0;
  let runLength = 0;
  for (let index = 0; index < gaps.length; index += 1) {
    const close = Math.abs(gaps[index] - median) <= Math.max(6, median * 0.22);
    if (close) {
      if (runLength === 0) runStart = index;
      runLength += 1;
      if (runLength > bestLength) {
        bestLength = runLength;
        bestStart = runStart;
      }
    } else runLength = 0;
  }
  const selected = lines.slice(bestStart, bestStart + bestLength + 1);
  if (selected.length < 31) return selected;
  return selected.slice(0, 33);
}

async function readCell(canvas: Canvas, x0: number, y0: number, x1: number, y1: number, whitelist: string) {
  const pad = 3;
  const png = canvasPng(canvas, x0 + pad, y0 + pad, Math.max(8, x1 - x0 - pad * 2), Math.max(8, y1 - y0 - pad * 2), 2);
  const result = await recognize(png, {
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    tessedit_char_whitelist: whitelist,
  });
  return result.data.text.replace(/\s+/g, " ").trim();
}

function pickName(text: string) {
  const lines = text
    .split(/\n/)
    .map((line) => line.replace(/[^A-Za-zÑñ'.,\- ]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const title = lines.findIndex((line) => /daily time record/i.test(line));
  const window = lines.slice(title >= 0 ? title + 1 : 0, title >= 0 ? title + 7 : 6);
  const skip = /civil service|form no|daily time|^\(?name\)?$|for the month|office hours|arrival|departure|regular day|saturday|undertime|am\b|pm\b/i;
  const candidates = window.filter((line) => !skip.test(line) && /[A-Za-z]{3,}/.test(line) && line.length > 4);
  return candidates.find((line) => line.includes(",")) ?? candidates.sort((a, b) => b.length - a.length)[0] ?? "";
}

async function readHeader(canvas: Canvas, table: TableGeometry) {
  const top = Math.max(0, table.rows[0] - 460);
  const png = canvasPng(canvas, table.cols[0] - 8, top, table.cols[table.cols.length - 1] - table.cols[0] + 16, table.rows[0] - top);
  const result = await recognize(png, { tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: "" });
  const text = result.data.text;
  return { name: pickName(text), period: parsePeriod(text), text };
}

function dayCount(rows: number[]) {
  return rows.length >= 33 ? 31 : 30;
}

async function readTable(canvas: Canvas, image: Rgba, cols: number[], rows: number[]) {
  const days: DayRow[] = [];
  for (let index = 0; index < dayCount(rows); index += 1) {
    const y0 = rows[index];
    const y1 = rows[index + 1];
    if (y1 == null) {
      days.push(emptyDay(index + 1));
      continue;
    }
    const cells = TIME_FIELDS.map((_, cell) => ({
      x0: cols[cell + 1],
      x1: cols[cell + 2],
      ink: inkRatio(image, cols[cell + 1], y0, cols[cell + 2], y1),
    }));
    const texts: string[] = [];
    for (const cell of cells) {
      if (cell.ink < INK) texts.push("");
      else texts.push(normalizeTime(await readCell(canvas, cell.x0, y0, cell.x1, y1, "0123456789:")));
    }
    const valid = texts.filter(Boolean).length;
    const row = emptyDay(index + 1);
    if (valid >= 2) {
      TIME_FIELDS.forEach((field, cell) => {
        if (texts[cell]) row[field] = texts[cell];
        else if (cells[cell].ink >= INK) row.keep.push(field);
      });
      days.push(row);
      continue;
    }
    const spanInk = Math.max(...cells.map((cell) => cell.ink));
    if (spanInk >= INK) {
      const label = canonicalLabel(
        await readCell(canvas, cols[1], y0, cols[5], y1, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.,/- "),
      );
      if (label && !normalizeTime(label)) {
        row.label = label;
        days.push(row);
        continue;
      }
    }
    TIME_FIELDS.forEach((field, cell) => {
      if (texts[cell]) row[field] = texts[cell];
      else if (cells[cell].ink >= INK) row.keep.push(field);
    });
    days.push(row);
  }
  return days;
}

export async function prepareUpload(bytes: Buffer, mime: string): Promise<Prepared> {
  if (mime === "application/pdf" || bytes.subarray(0, 4).toString() === "%PDF") {
    const rendered = await renderPdfPage(new Uint8Array(bytes), 1, SCALE);
    return {
      canvas: rendered.canvas,
      image: readPixels(rendered.canvas),
      scale: SCALE,
      pageWidth: rendered.pageWidth,
      pageHeight: rendered.pageHeight,
    };
  }
  const canvas = await loadRaster(bytes);
  return {
    canvas,
    image: readPixels(canvas),
    scale: 1,
    pageWidth: canvas.width,
    pageHeight: canvas.height,
  };
}

export async function readDtr(bytes: Buffer, mime: string): Promise<DtrRead> {
  const prepared = await prepareUpload(bytes, mime);
  const tables = groupTables(verticalLines(prepared.image));
  if (!tables.length) throw new Error("Could not find a Daily Time Record grid on this file.");
  const cols = tables[0];
  const rows = dayRows(prepared.image, cols);
  if (rows.length < 31) throw new Error("Could not find all 30 days on this Daily Time Record.");
  const header = await readHeader(prepared.canvas, { cols, rows });
  if (!header.name) throw new Error("Could not read the name above the time table.");
  if (!header.period) throw new Error("Could not read the cutoff period on this Daily Time Record.");
  const recognized = await readTable(prepared.canvas, prepared.image, cols, rows);
  const right = tables[tables.length - 1];
  const rightRows = right === cols ? rows : dayRows(prepared.image, right);
  const marked = new Set(workFromHomeDays(prepared.image, right, rightRows.length >= 31 ? rightRows : rows));
  for (const day of recognized) day.wfh = marked.has(day.day);
  return { name: header.name, period: header.period, recognized, warnings: [] };
}

/**
 * Days whose row has a "WFH" mark in the margin to the right of this table.
 * The mark is a short word, so a row counts only when that margin holds a
 * compact patch of ink rather than a rule or a speck.
 */
export function workFromHomeDays(image: Rgba, cols: number[], rows: number[]): number[] {
  const edge = cols[cols.length - 1];
  if (edge == null || rows.length < 2) return [];
  const gaps = rows.slice(1).map((row, index) => row - rows[index]).filter((gap) => gap > 18 && gap < 80);
  const pitch = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 40;
  const x0 = Math.round(edge + Math.max(4, pitch * 0.18));
  const x1 = Math.min(image.width - 1, Math.round(edge + pitch * 1.55));
  if (x1 - x0 < 8) return [];
  const dayCount = rows.length >= 33 ? 31 : Math.min(31, rows.length - 1);
  const found: number[] = [];
  for (let index = 0; index < dayCount; index += 1) {
    const y0 = rows[index];
    const y1 = rows[index + 1];
    if (y1 == null) continue;
    const top = Math.round(y0 + (y1 - y0) * 0.18);
    const bottom = Math.round(y1 - (y1 - y0) * 0.18);
    let dark = 0;
    let left = x1;
    let right = x0;
    for (let y = top; y < bottom; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (!isMark(image, x, y)) continue;
        dark += 1;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    const wide = right - left;
    const area = Math.max(1, (bottom - top) * (x1 - x0));
    if (dark >= Math.max(24, pitch * 0.8) && dark / area > 0.035 && wide > pitch * 0.35 && wide < pitch * 1.6) found.push(index + 1);
  }
  return found;
}

function isMark(image: Rgba, x: number, y: number) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  const index = (y * image.width + x) * 4;
  return (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3 < 170;
}

export async function locateGrid(bytes: Buffer, mime: string) {
  const prepared = await prepareUpload(bytes, mime);
  const tables = groupTables(verticalLines(prepared.image))
    .map((cols) => ({ cols, rows: dayRows(prepared.image, cols) }))
    .filter((table) => table.rows.length >= 31);
  if (!tables.length) throw new Error("Could not find a Daily Time Record grid on this file.");
  return { ...prepared, tables };
}
