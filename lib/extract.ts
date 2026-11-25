import { createCanvas, DOMMatrix, ImageData, Path2D, type Canvas } from "@napi-rs/canvas";
import path from "node:path";
import { createWorker, PSM, type Worker, type WorkerParams } from "tesseract.js";

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
};

type PdfPage = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: { canvasContext: unknown; viewport: unknown }) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
};

export type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
};

let patched = false;

function patchDom() {
  if (patched) return;
  const target = globalThis as unknown as Record<string, unknown>;
  if (!target.DOMMatrix) target.DOMMatrix = DOMMatrix;
  if (!target.ImageData) target.ImageData = ImageData;
  if (!target.Path2D) target.Path2D = Path2D;
  patched = true;
}

export async function openPdf(data: Uint8Array): Promise<PdfDocument> {
  patchDom();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  return doc as PdfDocument;
}

export async function renderPdfPage(data: Uint8Array, pageNumber: number, scale: number) {
  const doc = await openPdf(data);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const base = page.getViewport({ scale: 1 });
  return { canvas, pageWidth: base.width, pageHeight: base.height, pageCount: doc.numPages };
}

export async function loadRaster(bytes: Buffer) {
  const { loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);
  return canvas;
}

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      cachePath: path.join(process.cwd(), ".tessdata"),
    });
  }
  return workerPromise;
}

export function recognize(image: Buffer, parameters?: Partial<WorkerParams>) {
  const run = queue.then(async () => {
    const worker = await getWorker();
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      tessedit_char_whitelist: "",
      ...parameters,
    });
    return worker.recognize(image);
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function canvasPng(canvas: Canvas, x: number, y: number, w: number, h: number, upscale = 1) {
  const crop = createCanvas(Math.max(1, Math.round(w * upscale)), Math.max(1, Math.round(h * upscale)));
  const context = crop.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, crop.width, crop.height);
  context.imageSmoothingEnabled = upscale === 1;
  context.drawImage(canvas, x, y, w, h, 0, 0, crop.width, crop.height);
  return crop.toBuffer("image/png");
}

export type Rgba = { data: Uint8ClampedArray; width: number; height: number };

export function readPixels(canvas: Canvas): Rgba {
  const context = canvas.getContext("2d");
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data: image.data, width: canvas.width, height: canvas.height };
}

export function isDark(image: Rgba, x: number, y: number) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  const index = (y * image.width + x) * 4;
  return image.data[index] < 150 && image.data[index + 1] < 150 && image.data[index + 2] < 150;
}

export function inkRatio(image: Rgba, x0: number, y0: number, x1: number, y1: number) {
  let dark = 0;
  let total = 0;
  const left = Math.ceil(x0) + 4;
  const right = Math.floor(x1) - 4;
  const top = Math.ceil(y0) + 3;
  const bottom = Math.floor(y1) - 3;
  for (let y = top; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      total += 1;
      if (isDark(image, x, y)) dark += 1;
    }
  }
  return total ? dark / total : 0;
}
