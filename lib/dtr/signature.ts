import { isDark, type Rgba } from "../extract";
import type { Color } from "./surface";

export type SignatureLine = { y: number; x0: number; x1: number };

/** `rise` is how far the cap tops sit above the line's centre. */
export type NameStyle = { size: number; rise: number; height: number; color: Color };

function longestRun(image: Rgba, y: number, left: number, right: number) {
  let best = { x0: 0, x1: -1 };
  let start = -1;
  for (let x = left; x <= right + 1; x += 1) {
    const dark = x <= right && isDark(image, x, y);
    if (dark && start < 0) start = x;
    if (!dark && start >= 0) {
      if (x - 1 - start > best.x1 - best.x0) best = { x0: start, x1: x - 1 };
      start = -1;
    }
  }
  return best;
}

/** Long rules under the grid: the employee's line, then the head officer's. */
export function signatureLines(image: Rgba, cols: number[], rows: number[]): SignatureLine[] {
  const width = cols[cols.length - 1] - cols[0];
  const left = Math.max(0, Math.round(cols[0] - width * 0.25));
  const right = Math.min(image.width - 1, Math.round(cols[cols.length - 1] + width * 0.25));
  const lines: { ys: number[]; runs: { x0: number; x1: number }[] }[] = [];
  for (let y = Math.round(rows[rows.length - 1]) + 6; y < image.height; y += 1) {
    const run = longestRun(image, y, left, right);
    if (run.x1 - run.x0 < width * 0.7) continue;
    const last = lines[lines.length - 1];
    if (last && y - last.ys[last.ys.length - 1] <= 2) {
      last.ys.push(y);
      last.runs.push(run);
    } else lines.push({ ys: [y], runs: [run] });
  }
  return lines.map((line) => {
    const middle = Math.floor(line.ys.length / 2);
    return { y: (line.ys[0] + line.ys[line.ys.length - 1]) / 2, x0: line.runs[middle].x0, x1: line.runs[middle].x1 };
  });
}

/** Size, colour and offset of the name printed on `line`, in located pixels. */
export function nameStyle(image: Rgba, line: SignatureLine, capHeight: number): NameStyle | null {
  const counts: number[] = [];
  const top = Math.max(0, Math.round(line.y - 120));
  for (let y = top; y < line.y - 3; y += 1) {
    let count = 0;
    for (let x = line.x0; x <= line.x1; x += 1) if (isDark(image, x, y)) count += 1;
    counts.push(count);
  }
  let end = counts.length - 1;
  while (end >= 0 && counts[end] === 0) end -= 1;
  let start = end;
  while (start > 0 && counts[start - 1] > 0) start -= 1;
  if (end < 0) return null;
  const block = counts.slice(start, end + 1);
  const peak = Math.max(...block);
  const dense = block.map((count, index) => (count >= peak * 0.3 ? index : -1)).filter((index) => index >= 0);
  const capTop = top + start;
  const baseline = top + start + dense[dense.length - 1] + 1;
  const height = baseline - capTop;
  if (height < 4) return null;
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const pixels: { lum: number; index: number }[] = [];
  for (let y = capTop; y < baseline; y += 1) {
    for (let x = line.x0; x <= line.x1; x += 1) {
      const index = (y * image.width + x) * 4;
      const lum = (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
      if (lum < 160) pixels.push({ lum, index });
    }
  }
  pixels.sort((a, b) => a.lum - b.lum);
  for (const pixel of pixels.slice(0, Math.max(1, Math.round(pixels.length * 0.1)))) {
    reds.push(image.data[pixel.index]);
    greens.push(image.data[pixel.index + 1]);
    blues.push(image.data[pixel.index + 2]);
  }
  const mid = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] / 255;
  return { size: height / capHeight, rise: line.y - capTop, height, color: [mid(reds), mid(greens), mid(blues)] };
}
