import { PDFDocument } from "pdf-lib";
import { inkRatio, isDark, type Rgba } from "../extract";
import { locateGrid } from "./parse";
import { fillDays } from "./fill";
import { nameStyle, signatureLines } from "./signature";
import { FIGURE_HEIGHT, measureInk, measureRule, type InkStyle } from "./style";
import { fitBaseline, imageSurface, pageImage, photoSurface, vectorSurface, type Color, type Surface } from "./surface";
import { TIME_FIELDS, type DayRow, type Period } from "./types";

/** Everything here is in located-canvas pixels. */
type Pen = {
  surface: Surface;
  image: Rgba;
  style: InkStyle;
  /** Located pixels per point. */
  scale: number;
};

const WHITE: Color = [1, 1, 1];
const BLACK: Color = [0, 0, 0];

/** Name and period written on a blank official form. Uploads leave the printed heading alone. */
export type FormIdentity = { name: string; period: string };

export async function buildDtrPdf(
  bytes: Buffer,
  mime: string,
  recognized: DayRow[],
  days: DayRow[],
  period: Period,
  headOfficer = "",
  identity?: FormIdentity,
) {
  const proposal = fillDays(recognized, period);
  const isPdf = mime === "application/pdf" || bytes.subarray(0, 4).toString() === "%PDF";
  const pdf = isPdf ? await PDFDocument.load(bytes, { ignoreEncryption: true }) : await PDFDocument.create();
  const existing = isPdf ? pdf.getPages()[0] : null;
  const photo = existing ? pageImage(pdf, existing) : null;
  const located = photo ? await locateGrid(photo.jpeg, "image/jpeg") : await locateGrid(bytes, mime);
  let surface: Surface;
  let scale: number;

  if (photo) {
    scale = photo.width / photo.a;
    surface = await imageSurface(pdf, photo);
  } else if (existing) {
    scale = located.canvas.width / located.pageWidth;
    surface = await vectorSurface(pdf, existing, scale, located.pageHeight);
  } else {
    const page = pdf.addPage([612, 792]);
    const fit = Math.min(612 / located.canvas.width, 792 / located.canvas.height);
    const width = located.canvas.width * fit;
    const height = located.canvas.height * fit;
    scale = 1 / fit;
    surface = photoSurface(pdf, page, located.canvas, { x: (612 - width) / 2, y: (792 - height) / 2, width, height });
  }

  try {
    const form = pdf.getForm();
    for (const field of [...form.getFields()]) {
      if (/sig/i.test(field.getName())) form.removeField(field);
    }
  } catch {
    // A flattened scan has no editable signature field.
  }

  const sourceTable = located.tables[0];
  const pen: Pen = {
    surface,
    image: located.image,
    style: measureInk(located.image, sourceTable.cols, sourceTable.rows, recognized, scale),
    scale,
  };
  calibrateBaseline(pen, sourceTable.cols, sourceTable.rows, recognized);
  const source = new Map(recognized.map((day) => [day.day, day]));
  const proposed = new Map(proposal.map((day) => [day.day, day]));
  const finalDays = new Map(days.map((day) => [day.day, day]));

  for (const table of located.tables) {
    // Line positions are pixel indices; a pixel's middle is half a pixel in.
    const cols = table.cols.map((value) => value + 0.5);
    const rows = table.rows.map((value) => value + 0.5);
    const dayCount = rows.length >= 33 ? 31 : 30;
    for (let index = 0; index < dayCount; index += 1) {
      const day = index + 1;
      const outside = day < period.startDay || day > period.endDay;
      const before = source.get(day);
      let after = finalDays.get(day);
      if (outside) {
        if (!identity) continue;
        const dow = new Date(Date.UTC(period.year, period.month - 1, day)).getUTCDay();
        if (dow !== 0 && dow !== 6) continue;
        after = { day, label: dow === 0 ? "Sunday" : "Saturday", amIn: "", amOut: "", pmIn: "", pmOut: "", keep: [] };
      }
      const suggested = proposed.get(day);
      if (!before || !after || !suggested) continue;
      const y0 = rows[index];
      const y1 = rows[index + 1];

      if (after.label !== before.label) {
        const fill = /^(saturday|sunday)$/i.test(after.label) ? pen.style.shade : WHITE;
        const edges = cols.length >= 8 ? [0, 1, 5, 6, 7] : [0, 1, 5];
        for (let edge = 0; edge + 1 < edges.length; edge += 1) paint(pen, cols[edges[edge]], y0, cols[edges[edge + 1]], y1, fill);
        if (!after.label && before.label) {
          for (const column of [2, 3, 4]) columnRule(pen, cols[column], y0, y1);
        }
        const probe = Math.round(cols[0] + (cols[1] - cols[0]) * 0.15);
        for (const edge of [y0, y1]) {
          const center = measureRule(located.image, probe, Math.floor(edge), false)?.center ?? edge;
          rowRule(pen, cols[0], cols[edges[edges.length - 1]], center);
        }
        write(pen, String(day), cols[0], y0, cols[1], y1, true);
        if (after.label) {
          write(pen, after.label, cols[1], y0, cols[5], y1, false);
          continue;
        }
      } else if (after.label) continue;

      const mid = Math.round((y0 + y1) / 2);
      const guide = measureRule(located.image, Math.round(cols[5]), mid, true);
      const thickness = guide && guide.thickness > 1.5 ? guide.thickness : pen.style.line * pen.scale;
      for (const column of [2, 3, 4]) {
        const rule = measureRule(located.image, Math.round(cols[column]), mid, true);
        if (rule && rule.thickness >= thickness * 0.85) continue;
        const fromY = ruleSample(located.image, cols[column], rows, thickness);
        if (fromY == null) continue;
        pen.surface.rule(cols[column], y0, y1, fromY);
      }
      for (const field of TIME_FIELDS) {
        const column = TIME_FIELDS.indexOf(field) + 1;
        const x0 = cols[column];
        const x1 = cols[column + 1];
        const next = after[field];
        const prev = before[field];
        if (next === prev && !before.label) continue;
        const kept = before.keep.includes(field);
        const untouchedProposal = next === suggested[field] && !prev && kept;
        if (untouchedProposal) continue;
        if (prev || kept) wipe(pen, x0, y0, x1, y1);
        if (next) write(pen, next, x0, y0, x1, y1, false);
      }
      if (!before.label) clearUndertime(pen, cols, y0, y1);
    }
    const totalTop = rows[dayCount];
    const totalBottom = rows[dayCount + 1] ?? totalTop + (rows[dayCount] - rows[dayCount - 1]);
    if (cols.length >= 8) {
      for (const [start, end] of [
        [5, 6],
        [6, 7],
      ] as const) {
        wipe(pen, cols[start], totalTop, cols[end], totalBottom);
        write(pen, "0", cols[start], totalTop, cols[end], totalBottom, false);
      }
    }
    if (identity) writeIdentity(pen, table.cols, table.rows, identity);
    if (headOfficer.trim()) signHead(pen, table.cols, table.rows, headOfficer.trim());
  }

  await surface.finish();
  return Buffer.from(await pdf.save());
}

function calibrateBaseline(pen: Pen, tableCols: number[], tableRows: number[], recognized: DayRow[]) {
  const cols = tableCols.map((value) => value + 0.5);
  const rows = tableRows.map((value) => value + 0.5);
  const samples = recognized
    .filter((row) => !row.label && rows[row.day] != null)
    .flatMap((row) =>
      TIME_FIELDS.filter((field) => row[field]).map((field) => {
        const column = TIME_FIELDS.indexOf(field) + 1;
        const y0 = rows[row.day - 1];
        const y1 = rows[row.day];
        return { text: row[field], x0: cols[column], x1: cols[column + 1], y0, y1, baseline: y0 + pen.style.baseline * (y1 - y0) };
      }),
    )
    .slice(0, 12);
  if (!samples.length) return;
  const shift = fitBaseline(pen.image, samples, pen.style.size * pen.scale);
  const pitch = samples.reduce((sum, sample) => sum + sample.y1 - sample.y0, 0) / samples.length;
  pen.style.baseline += shift / pitch;
}

function writeIdentity(pen: Pen, cols: number[], rows: number[], identity: FormIdentity) {
  const rules = horizontalRules(pen.image, cols[0], cols[cols.length - 1], 40, rows[0]);
  const span = cols[cols.length - 1] - cols[0];
  const nameLine = rules.find((rule) => rule.width > span * 0.8);
  const monthLine = rules.find(
    (rule) => nameLine && rule.y > nameLine.y + 40 && rule.y < nameLine.y + 130 && rule.width > span * 0.45 && rule.x0 > cols[0] + 80,
  );
  const size = pen.style.size * pen.scale;
  if (identity.name && nameLine) {
    place(pen, identity.name, (nameLine.x0 + nameLine.x1) / 2, nameLine.y - size * 0.58, size, nameLine.x1 - nameLine.x0 - 28);
  }
  if (identity.period && monthLine) {
    place(pen, identity.period, (monthLine.x0 + monthLine.x1) / 2, monthLine.y - size * 0.42, size, monthLine.x1 - monthLine.x0 - 12);
  }
  const employee = signatureLines(pen.image, cols, rows)[0];
  if (identity.name && employee) {
    place(pen, identity.name, (employee.x0 + employee.x1) / 2, employee.y - size * 0.58, size, employee.x1 - employee.x0 - 16);
  }
}

function place(pen: Pen, text: string, cx: number, baseline: number, size: number, room: number) {
  let fitted = size;
  while (fitted > size * 0.6 && pen.surface.width(text, fitted, true) > room) fitted *= 0.96;
  pen.surface.text(text, cx, baseline, fitted, true, pen.style.ink);
}

function horizontalRules(image: Rgba, x0: number, x1: number, y0: number, y1: number) {
  const found: { y: number; x0: number; x1: number; width: number }[] = [];
  let run: { y: number; end: number; x0: number; x1: number; width: number } | null = null;
  const left = Math.max(0, Math.round(x0));
  const right = Math.min(image.width - 1, Math.round(x1));
  for (let y = Math.round(y0); y < y1; y += 1) {
    let dark = 0;
    let start = -1;
    let end = -1;
    for (let x = left; x < right; x += 1) {
      if (!isDark(image, x, y)) continue;
      dark += 1;
      if (start < 0) start = x;
      end = x;
    }
    if (dark > (right - left) * 0.2 && start >= 0) {
      if (!run) run = { y, end: y, x0: start, x1: end, width: dark };
      else {
        run.end = y;
        run.x0 = Math.min(run.x0, start);
        run.x1 = Math.max(run.x1, end);
        run.width = Math.max(run.width, dark);
      }
    } else if (run) {
      found.push({ y: (run.y + run.end) / 2, x0: run.x0, x1: run.x1, width: run.width });
      run = null;
    }
  }
  return found;
}

function signHead(pen: Pen, cols: number[], rows: number[], name: string) {
  const lines = signatureLines(pen.image, cols, rows);
  const head = lines[lines.length - 1];
  if (!head) return;
  const printed = lines.length >= 2 ? nameStyle(pen.image, lines[lines.length - 2], FIGURE_HEIGHT) : null;
  const employee = printed && printed.rise < printed.height * 2.5 ? printed : null;
  const timeSize = pen.style.size * pen.scale;
  const measured = employee?.size ?? timeSize;
  const size = Math.abs(measured - timeSize) / timeSize < 0.08 ? timeSize : measured;
  const height = size * FIGURE_HEIGHT;
  const rise = employee?.rise ?? height + size * 0.58;
  const half = (measureRule(pen.image, Math.round((head.x0 + head.x1) / 2), Math.round(head.y), false)?.thickness ?? 3) / 2;
  const baseline = head.y - rise + height;
  pen.surface.rect(head.x0, head.y - rise - height * 0.6, head.x1 + 1, head.y - half - 0.5, WHITE);
  const bold = !employee;
  let fitted = size;
  while (fitted > size * 0.6 && pen.surface.width(name, fitted, bold) > head.x1 - head.x0 - 8) fitted *= 0.97;
  pen.surface.text(name, (head.x0 + head.x1 + 1) / 2, baseline, fitted, bold, employee?.color ?? pen.style.ink);
}

function clearUndertime(pen: Pen, cols: number[], y0: number, y1: number) {
  if (cols.length < 8 || y1 <= y0) return;
  for (const [start, end] of [
    [5, 6],
    [6, 7],
  ] as const) {
    if (inkRatio(pen.image, cols[start], y0, cols[end], y1) < 0.02) continue;
    wipe(pen, cols[start], y0, cols[end], y1);
  }
}

function wipe(pen: Pen, x0: number, y0: number, x1: number, y1: number) {
  const inset = 1.4 * pen.scale;
  pen.surface.rect(x0 + inset, y0 + inset, x1 - inset, y1 - inset, WHITE);
}

/** Fills a cell between its column rules, through to the middle of its row rules. */
function paint(pen: Pen, x0: number, y0: number, x1: number, y1: number, color: Color) {
  const inset = (pen.style.line * pen.scale) / 2;
  pen.surface.rect(x0 + inset, y0, x1 - inset, y1, color);
}

function ruleSample(image: Rgba, x: number, rows: number[], thickness: number) {
  const at = Math.round(x);
  for (let index = 0; index < Math.min(31, Math.max(0, rows.length - 2)); index += 1) {
    const y = Math.round((rows[index] + rows[index + 1]) / 2);
    const found = measureRule(image, at, y, true);
    if (found && found.thickness >= thickness * 0.85) return y;
  }
  return null;
}

function columnRule(pen: Pen, x: number, y0: number, y1: number) {
  const half = (pen.style.line * pen.scale) / 2;
  pen.surface.rect(x - half, y0, x + half, y1, BLACK);
}

function rowRule(pen: Pen, x0: number, x1: number, y: number) {
  const half = (pen.style.line * pen.scale) / 2;
  const thick = (pen.style.rowLine * pen.scale) / 2;
  pen.surface.rect(x0 - half, y - thick, x1 + half, y + thick, BLACK);
}

function write(pen: Pen, text: string, x0: number, y0: number, x1: number, y1: number, bold: boolean) {
  let size = pen.style.size * pen.scale;
  const room = x1 - x0 - 4 * pen.scale;
  while (size > 5 * pen.scale && pen.surface.width(text, size, bold) > room) size -= 0.25 * pen.scale;
  pen.surface.text(text, (x0 + x1) / 2, y0 + pen.style.baseline * (y1 - y0), size, bold, pen.style.ink);
}
