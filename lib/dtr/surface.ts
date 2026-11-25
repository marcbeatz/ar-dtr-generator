import path from "node:path";
import { createCanvas, GlobalFonts, loadImage, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedInter } from "../fonts";
import { inkExtent } from "./style";

/** RGB, 0-1. */
export type Color = [number, number, number];

/** Drawing in the coordinates of the located page canvas, in its pixels. */
export interface Surface {
  rect(x0: number, y0: number, x1: number, y1: number, color: Color): void;
  /** Repeats the vertical rule at `x`, sampled from `fromY`, between `y0` and `y1`. */
  rule(x: number, y0: number, y1: number, fromY: number): void;
  /** Draws `text` centred on `cx`, sitting on `baseline`. */
  text(text: string, cx: number, baseline: number, size: number, bold: boolean, color: Color): void;
  width(text: string, size: number, bold: boolean): number;
  finish(): Promise<void>;
}

const FAMILY = "DTR Inter";
const FAMILY_BOLD = "DTR Inter Bold";
let registered = false;

function registerFonts() {
  if (registered) return;
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets/fonts/Inter-Regular.ttf"), FAMILY);
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets/fonts/Inter-Bold.ttf"), FAMILY_BOLD);
  registered = true;
}

/** Inter's cap height and figure height, in ems. */
const CAP_HEIGHT = 1490 / 2048;

/**
 * Draws like a browser rasteriser with vertical hinting: overshoots are pulled
 * in so the ink sits exactly on a pixel-aligned baseline and spans a whole
 * number of pixels for the cap height, giving crisp tops and bottoms.
 */
function fillHinted(context: SKRSContext2D, text: string, x: number, baseline: number, size: number, bold: boolean) {
  const { a, d, e, f } = context.getTransform();
  const px = size * d;
  const extent = inkExtent(text, bold);
  const ink = (extent.top - extent.bottom) * px;
  const descends = extent.bottom < -0.05;
  const stretch = ink > 0 && !descends ? Math.max(1, Math.round(px * CAP_HEIGHT)) / ink : 1;
  const deviceX = x * a + e;
  const deviceBaseline = Math.round(baseline * d + f);

  // Skia's own hinting rounds Inter's cap height to the wrong row count, so
  // draw large (where hinting is negligible) and let the downscale antialias.
  const zoom = 8;
  const font = `${px * zoom}px "${bold ? FAMILY_BOLD : FAMILY}"`;
  const left = Math.floor(deviceX) - 2;
  const top = deviceBaseline - Math.ceil(px * 1.2);
  const bottom = deviceBaseline + Math.ceil(px * 0.4);
  context.font = font;
  const right = Math.ceil(deviceX + context.measureText(text).width / zoom) + 2;
  const big = createCanvas((right - left) * zoom, (bottom - top) * zoom);
  const pen = big.getContext("2d");
  pen.font = font;
  pen.fillStyle = context.fillStyle;
  pen.translate((deviceX - left) * zoom, (deviceBaseline - top) * zoom + (descends ? 0 : extent.bottom * px * stretch * zoom));
  pen.scale(1, stretch);
  pen.fillText(text, 0, 0);

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(big, left, top, right - left, bottom - top);
  context.restore();
}

type Sample = { text: string; x0: number; y0: number; x1: number; y1: number; baseline: number };

function darknessByRow(data: Uint8ClampedArray, width: number, x0: number, x1: number, y0: number, y1: number) {
  const rows: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    let sum = 0;
    for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4;
      sum += 255 - (data[index] + data[index + 1] + data[index + 2]) / 3;
    }
    rows.push(sum);
  }
  return rows;
}

/**
 * How far, in pixels, to move the estimated baseline so Inter rendered here
 * lines up with the printed samples row for row.
 */
export function fitBaseline(image: { data: Uint8ClampedArray; width: number }, samples: Sample[], size: number) {
  registerFonts();
  let best = { shift: 0, error: Infinity };
  for (let shift = -2; shift <= 2; shift += 1) {
    let error = 0;
    for (const sample of samples) {
      const left = Math.ceil(sample.x0) + 3;
      const right = Math.floor(sample.x1) - 3;
      const top = Math.ceil(sample.y0) + 3;
      const bottom = Math.floor(sample.y1) - 3;
      const printed = darknessByRow(image.data, image.width, left, right, top, bottom);
      const trial = createCanvas(right - left, bottom - top);
      const context = trial.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, trial.width, trial.height);
      context.fillStyle = "#000";
      context.font = `${size}px "${FAMILY}"`;
      const width = context.measureText(sample.text).width;
      fillHinted(context, sample.text, (sample.x0 + sample.x1) / 2 - width / 2 - left, sample.baseline + shift - top, size, false);
      const drawn = darknessByRow(context.getImageData(0, 0, trial.width, trial.height).data, trial.width, 0, trial.width, 0, trial.height);
      const scale = printed.reduce((a, b) => a + b, 0) / Math.max(1, drawn.reduce((a, b) => a + b, 0));
      for (let row = 0; row < printed.length; row += 1) error += (printed[row] - drawn[row] * scale) ** 2;
    }
    if (error < best.error) best = { shift, error };
  }
  return best.shift;
}

function css([r, g, b]: Color) {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

class RasterSurface implements Surface {
  private context: SKRSContext2D;

  constructor(
    readonly canvas: Canvas,
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number,
    private readonly done: (canvas: Canvas) => Promise<void>,
  ) {
    registerFonts();
    this.context = canvas.getContext("2d");
    this.context.setTransform(scaleX, 0, 0, scaleY, offsetX, offsetY);
    this.context.textAlign = "left";
    this.context.textBaseline = "alphabetic";
  }

  rect(x0: number, y0: number, x1: number, y1: number, color: Color) {
    this.context.fillStyle = css(color);
    this.context.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  rule(x: number, y0: number, y1: number, fromY: number) {
    const half = 5;
    const left = Math.round(x) - half;
    const width = half * 2 + 1;
    const sample = this.context.getImageData(left, Math.round(fromY), width, 1);
    const top = Math.ceil(Math.min(y0, y1));
    const bottom = Math.floor(Math.max(y0, y1));
    for (let y = top; y <= bottom; y += 1) {
      const beside = this.context.getImageData(left - 4, y, 1, 1);
      const lum = (beside.data[0] + beside.data[1] + beside.data[2]) / 3;
      if (lum < 80) continue;
      this.context.putImageData(sample, left, y);
    }
  }

  private font(size: number, bold: boolean) {
    this.context.font = `${size}px "${bold ? FAMILY_BOLD : FAMILY}"`;
  }

  width(text: string, size: number, bold: boolean) {
    this.font(size, bold);
    return this.context.measureText(text).width;
  }

  text(text: string, cx: number, baseline: number, size: number, bold: boolean, color: Color) {
    this.font(size, bold);
    this.context.fillStyle = css(color);
    fillHinted(this.context, text, cx - this.context.measureText(text).width / 2, baseline, size, bold);
  }

  finish() {
    return this.done(this.canvas);
  }
}

class VectorSurface implements Surface {
  constructor(
    private readonly page: PDFPage,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    /** Located pixels per point. */
    private readonly scale: number,
    private readonly pageHeight: number,
    private readonly offsetX: number,
    private readonly offsetY: number,
  ) {}

  private x(value: number) {
    return this.offsetX + value / this.scale;
  }

  private y(value: number) {
    return this.offsetY + this.pageHeight - value / this.scale;
  }

  rule(x: number, y0: number, y1: number, _fromY: number) {
    this.rect(x - 0.6, y0, x + 0.6, y1, [0, 0, 0]);
  }

  rect(x0: number, y0: number, x1: number, y1: number, color: Color) {
    this.page.drawRectangle({
      x: this.x(x0),
      y: this.y(y1),
      width: (x1 - x0) / this.scale,
      height: (y1 - y0) / this.scale,
      color: rgb(...color),
      borderWidth: 0,
    });
  }

  width(text: string, size: number, bold: boolean) {
    return (bold ? this.bold : this.regular).widthOfTextAtSize(text, size / this.scale) * this.scale;
  }

  text(text: string, cx: number, baseline: number, size: number, bold: boolean, color: Color) {
    const width = this.width(text, size, bold);
    this.page.drawText(text, {
      x: this.x(cx - width / 2),
      y: this.y(baseline),
      size: size / this.scale,
      font: bold ? this.bold : this.regular,
      color: rgb(...color),
    });
  }

  async finish() {}
}

export type Placement = { name: string; ref: PDFRef; a: number; d: number; e: number; f: number; width: number; height: number; jpeg: Buffer };

function pageContent(pdf: PDFDocument, page: PDFPage) {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((item) => pdf.context.lookup(item)) : [contents];
  return streams
    .map((stream) => (stream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1") : ""))
    .join("\n");
}

/** The JPEG drawn over most of the page, as jsPDF and scanner exports do. */
export function pageImage(pdf: PDFDocument, page: PDFPage): Placement | null {
  const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return null;
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const pattern = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm\s+\/([^\s/]+)\s+Do/g;
  let best: Placement | null = null;
  for (const match of pageContent(pdf, page).matchAll(pattern)) {
    const [a, b, c, d, e, f] = match.slice(1, 7).map(Number);
    if (b !== 0 || c !== 0 || a <= 0 || d <= 0) continue;
    const ref = xobjects.get(PDFName.of(match[7]));
    if (!(ref instanceof PDFRef)) continue;
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const dict = stream.dict;
    if (dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    if (dict.get(PDFName.of("Filter"))?.toString() !== "/DCTDecode") continue;
    if (a * d < pageWidth * pageHeight * 0.5) continue;
    if (!best || a * d > best.a * best.d) {
      best = {
        name: match[7],
        ref,
        a,
        d,
        e,
        f,
        width: Number(dict.get(PDFName.of("Width"))?.toString()),
        height: Number(dict.get(PDFName.of("Height"))?.toString()),
        jpeg: Buffer.from(stream.contents),
      };
    }
  }
  return best;
}

/**
 * Draws straight into the page's photo, in its pixels, so added text is
 * rasterised like the printed text.
 */
export async function imageSurface(pdf: PDFDocument, placement: Placement): Promise<Surface> {
  const stream = pdf.context.lookup(placement.ref) as PDFRawStream;
  const photo = await loadImage(placement.jpeg);
  const canvas = createCanvas(photo.width, photo.height);
  canvas.getContext("2d").drawImage(photo, 0, 0);
  return new RasterSurface(canvas, 1, 1, 0, 0, async (patched) => {
    const jpeg = patched.toBuffer("image/jpeg", 100);
    const dict = stream.dict.clone(pdf.context);
    dict.set(PDFName.of("Length"), pdf.context.obj(jpeg.length));
    dict.delete(PDFName.of("DecodeParms"));
    pdf.context.assign(placement.ref, PDFRawStream.of(dict, new Uint8Array(jpeg)));
  });
}

/** Vector text on the page, for PDFs that are not a single photo. */
export async function vectorSurface(pdf: PDFDocument, page: PDFPage, scale: number, pageHeight: number): Promise<Surface> {
  return new VectorSurface(page, await embedInter(pdf), await embedInter(pdf, true), scale, pageHeight, 0, 0);
}

/** For photo uploads: draws on a copy of the photo, then places it on `page`. */
export function photoSurface(pdf: PDFDocument, page: PDFPage, source: Canvas, box: { x: number; y: number; width: number; height: number }): Surface {
  registerFonts();
  const canvas = createCanvas(source.width, source.height);
  canvas.getContext("2d").drawImage(source, 0, 0);
  return new RasterSurface(canvas, 1, 1, 0, 0, async (patched) => {
    const image = await pdf.embedJpg(patched.toBuffer("image/jpeg", 95));
    page.drawImage(image, box);
  });
}
