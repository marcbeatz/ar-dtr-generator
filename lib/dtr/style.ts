import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { Rgba } from "../extract";
import { TIME_FIELDS, type DayRow } from "./types";

/** Inter draws its figures at cap height, 1490 of 2048 units. */
export const FIGURE_HEIGHT = 1490 / 2048;

let inter: ReturnType<typeof fontkit.create> | null = null;

/** Width of the inked part of `text` in Inter Regular, in ems. */
function inkWidth(text: string) {
  inter ??= fontkit.create(readFileSync(path.join(process.cwd(), "assets/fonts/Inter-Regular.ttf")));
  const run = inter.layout(text);
  let pen = 0;
  let left = Infinity;
  let right = -Infinity;
  run.glyphs.forEach((glyph, index) => {
    const box = glyph.bbox;
    if (box.maxX > box.minX) {
      left = Math.min(left, pen + box.minX);
      right = Math.max(right, pen + box.maxX);
    }
    pen += run.positions[index].xAdvance;
  });
  return right > left ? (right - left) / inter.unitsPerEm : 0;
}

let interBold: ReturnType<typeof fontkit.create> | null = null;

/** Highest and lowest inked points of `text` above the baseline, in ems. */
export function inkExtent(text: string, bold = false) {
  const font = bold
    ? (interBold ??= fontkit.create(readFileSync(path.join(process.cwd(), "assets/fonts/Inter-Bold.ttf"))))
    : (inter ??= fontkit.create(readFileSync(path.join(process.cwd(), "assets/fonts/Inter-Regular.ttf"))));
  let top = -Infinity;
  let bottom = Infinity;
  for (const glyph of font.layout(text).glyphs) {
    const box = glyph.bbox;
    if (box.maxY > box.minY) {
      top = Math.max(top, box.maxY);
      bottom = Math.min(bottom, box.minY);
    }
  }
  return top > bottom ? { top: top / font.unitsPerEm, bottom: bottom / font.unitsPerEm } : { top: 0, bottom: 0 };
}

export type InkStyle = {
  /** RGB, 0-1. */
  ink: [number, number, number];
  shade: [number, number, number];
  /** Points. */
  size: number;
  /** Where the printed times sit, as a fraction of the way down their row. */
  baseline: number;
  /** Thickness of the column rules, in points. */
  line: number;
  /** Thickness of the row rules, in points. */
  rowLine: number;
};

const DEFAULT: InkStyle = {
  ink: [73 / 255, 80 / 255, 88 / 255],
  shade: [209 / 255, 209 / 255, 209 / 255],
  size: 8,
  baseline: 0.72,
  line: 1.2,
  rowLine: 1,
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function luminanceAt(image: Rgba, x: number, y: number) {
  const index = (Math.round(y) * image.width + Math.round(x)) * 4;
  return (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
}

function inkInCell(image: Rgba, x0: number, y0: number, x1: number, y1: number) {
  const left = Math.ceil(x0) + 4;
  const right = Math.floor(x1) - 4;
  const top = Math.ceil(y0) + 3;
  const bottom = Math.floor(y1) - 3;
  if (right <= left || bottom <= top) return null;
  const background = median([
    luminanceAt(image, left, top),
    luminanceAt(image, right, top),
    luminanceAt(image, left, bottom),
    luminanceAt(image, right, bottom),
  ])!;
  let minY = bottom;
  let maxY = top;
  const dark: { lum: number; index: number }[] = [];
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const index = (y * image.width + x) * 4;
      const lum = (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
      if (background - lum < 70) continue;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      dark.push({ lum, index });
    }
  }
  if (maxY <= minY) return null;
  const core = median([...dark].sort((a, b) => a.lum - b.lum).slice(0, Math.max(1, Math.round(dark.length * 0.1))).map((pixel) => pixel.lum))!;
  // Antialiased glyph edges are where coverage crosses one half.
  const edge = (background + core) / 2;
  let inkLeft = right;
  let inkRight = left;
  let inkBottom = top;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (luminanceAt(image, x, y) >= edge) continue;
      inkLeft = Math.min(inkLeft, x);
      inkRight = Math.max(inkRight, x);
      inkBottom = Math.max(inkBottom, y);
    }
  }
  return { width: inkRight - inkLeft + 1, bottom: inkBottom + 1, dark };
}

/**
 * Thickness and centre of a rule crossing (x, y), in pixels, weighted by coverage
 * so antialiased edges count partially. `vertical` means the rule runs up and down.
 */
export function measureRule(image: Rgba, x: number, y: number, vertical: boolean) {
  const reach = 6;
  const at = (offset: number) =>
    vertical ? luminanceAt(image, Math.min(image.width - 1, Math.max(0, x + offset)), y) : luminanceAt(image, x, Math.min(image.height - 1, Math.max(0, y + offset)));
  const background = Math.max(at(-reach), at(reach), 1);
  let thickness = 0;
  let moment = 0;
  for (let offset = -reach + 1; offset < reach; offset += 1) {
    const weight = Math.min(1, Math.max(0, (background - at(offset)) / background));
    thickness += weight;
    moment += weight * offset;
  }
  if (thickness < 0.5) return null;
  return { thickness, center: (vertical ? x : y) + 0.5 + moment / thickness };
}

export function measureInk(image: Rgba, cols: number[], rows: number[], recognized: DayRow[], pxPerPt: number): InkStyle {
  const sizes: number[] = [];
  const baselines: number[] = [];
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const shades: number[] = [];
  const lines: number[] = [];
  const rowLines: number[] = [];
  for (const row of recognized) {
    const y0 = rows[row.day - 1];
    const y1 = rows[row.day];
    if (y0 == null || y1 == null) continue;
    const below = measureRule(image, Math.round((cols[0] + cols[1]) / 2), y1, false);
    if (below) rowLines.push(below.thickness);
    if (row.label) {
      shades.push(luminanceAt(image, cols[1] + 4, (y0 + y1) / 2), luminanceAt(image, cols[5] - 4, (y0 + y1) / 2));
      continue;
    }
    for (const field of TIME_FIELDS) {
      if (!row[field]) continue;
      const column = TIME_FIELDS.indexOf(field) + 1;
      const cell = inkInCell(image, cols[column], y0, cols[column + 1], y1);
      if (!cell) continue;
      const em = inkWidth(row[field]);
      if (em) sizes.push(cell.width / em);
      baselines.push((cell.bottom - (y0 + 0.5)) / (y1 - y0));
      const core = [...cell.dark].sort((a, b) => a.lum - b.lum).slice(0, Math.max(1, Math.round(cell.dark.length * 0.1)));
      for (const pixel of core) {
        reds.push(image.data[pixel.index]);
        greens.push(image.data[pixel.index + 1]);
        blues.push(image.data[pixel.index + 2]);
      }
      const right = column < 4 ? measureRule(image, cols[column + 1], Math.round((y0 + y1) / 2), true) : null;
      if (right) lines.push(right.thickness);
    }
  }
  const size = median(sizes);
  const baseline = median(baselines);
  const shade = median(shades);
  const line = median(lines);
  const rowLine = median(rowLines);
  return {
    ink: reds.length ? [median(reds)! / 255, median(greens)! / 255, median(blues)! / 255] : DEFAULT.ink,
    shade: shade != null && shade > 150 && shade < 245 ? [shade / 255, shade / 255, shade / 255] : DEFAULT.shade,
    size: size ? size / pxPerPt : DEFAULT.size,
    baseline: baseline ?? DEFAULT.baseline,
    line: line ? line / pxPerPt : DEFAULT.line,
    rowLine: rowLine ? rowLine / pxPerPt : DEFAULT.rowLine,
  };
}
