import { createCanvas } from "@napi-rs/canvas";
import { isDark, openPdf, readPixels, renderPdfPage, loadRaster, type PdfTextItem } from "../extract";

export type Letterhead = {
  header: Buffer;
  footer: Buffer;
  headerHeight: number;
  footerHeight: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function longLines(image: ReturnType<typeof readPixels>) {
  const minRun = image.width * 0.58;
  const found: number[] = [];
  for (let y = 0; y < image.height; y += 1) {
    let run = 0;
    let max = 0;
    for (let x = 0; x < image.width; x += 1) {
      if (isDark(image, x, y)) {
        run += 1;
        if (run > max) max = run;
      } else run = 0;
    }
    if (max >= minRun) found.push(y);
  }
  const groups: number[] = [];
  for (const y of found) {
    if (!groups.length || y - groups[groups.length - 1] > 3) groups.push(y);
    else groups[groups.length - 1] = y;
  }
  return groups;
}

function itemText(items: PdfTextItem[], pattern: RegExp) {
  return items.find((item) => pattern.test(item.str));
}

export async function readLetterhead(bytes: Buffer, mime: string): Promise<Letterhead> {
  const isPdf = mime === "application/pdf" || bytes.subarray(0, 4).toString() === "%PDF";
  const scale = 2;
  let canvas;
  let pageWidth = 612;
  let pageHeight = 792;
  let items: PdfTextItem[] = [];
  if (isPdf) {
    const rendered = await renderPdfPage(new Uint8Array(bytes), 1, scale);
    canvas = rendered.canvas;
    pageWidth = rendered.pageWidth;
    pageHeight = rendered.pageHeight;
    const doc = await openPdf(new Uint8Array(bytes));
    const page = await doc.getPage(1);
    items = (await page.getTextContent()).items;
  } else {
    canvas = await loadRaster(bytes);
    pageWidth = 612;
    pageHeight = 792;
  }

  const image = readPixels(canvas);
  const lines = longLines(image).map((y) => y / (isPdf ? scale : canvas.height / pageHeight));
  const title = itemText(items, /MONTHLY ACCOMPLISHMENT/i);
  const footer = itemText(items, /DICT Headquarters|Monthly AR/i);
  const titleFromTop = title ? pageHeight - title.transform[5] : pageHeight * 0.2;
  const footerFromTop = footer ? pageHeight - footer.transform[5] : pageHeight * 0.9;
  const aboveTitle = lines.filter((y) => y < titleFromTop - 8);
  const top = aboveTitle.length ? aboveTitle[aboveTitle.length - 1] : 118;
  const below = lines.filter((y) => y > top + 40 && y < footerFromTop - 6);
  const bottom = below.length ? below[below.length - 1] : pageHeight - 78;
  const vertical = verticalBounds(image, top * (isPdf ? scale : 1), bottom * (isPdf ? scale : 1));
  const pixelScale = isPdf ? scale : canvas.height / pageHeight;
  const left = vertical.left / pixelScale;
  const right = vertical.right / pixelScale;

  const pageNumber = items.find((item) => /Monthly AR/i.test(item.str));
  if (pageNumber) {
    const context = canvas.getContext("2d");
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    const x0 = Math.max(0, Math.floor((pageNumber.transform[4] - 4) * pixelScale));
    const x1 = Math.min(canvas.width, Math.ceil((pageNumber.transform[4] + 130) * pixelScale));
    const y0 = Math.max(0, Math.floor((pageHeight - pageNumber.transform[5] - 12) * pixelScale));
    const y1 = Math.min(canvas.height, Math.ceil((pageHeight - pageNumber.transform[5] + 4) * pixelScale));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = (y * canvas.width + x) * 4;
        data.data[index] = 255;
        data.data[index + 1] = 255;
        data.data[index + 2] = 255;
      }
    }
    context.putImageData(data, 0, 0);
  }

  const headerPx = Math.max(8, Math.round(top * pixelScale));
  const footerStart = Math.round(bottom * pixelScale);
  const headerCanvas = createCanvas(canvas.width, headerPx);
  headerCanvas.getContext("2d").drawImage(canvas, 0, 0, canvas.width, headerPx, 0, 0, canvas.width, headerPx);
  const footerHeightPx = Math.max(8, canvas.height - footerStart);
  const footerCanvas = createCanvas(canvas.width, footerHeightPx);
  footerCanvas.getContext("2d").drawImage(canvas, 0, footerStart, canvas.width, footerHeightPx, 0, 0, canvas.width, footerHeightPx);

  return {
    header: headerCanvas.toBuffer("image/png"),
    footer: footerCanvas.toBuffer("image/png"),
    headerHeight: top,
    footerHeight: pageHeight - bottom,
    left: Math.max(36, left),
    right: Math.min(pageWidth - 36, right),
    top,
    bottom,
  };
}

function verticalBounds(image: ReturnType<typeof readPixels>, top: number, bottom: number) {
  const y0 = Math.max(0, Math.floor(top));
  const y1 = Math.min(image.height - 1, Math.floor(bottom));
  const span = Math.max(1, y1 - y0);
  let left = 48;
  let right = image.width - 48;
  const found: number[] = [];
  for (let x = 0; x < image.width; x += 1) {
    let count = 0;
    for (let y = y0; y < y1; y += 2) if (isDark(image, x, y)) count += 1;
    if (count > span / 2 / 2) found.push(x);
  }
  if (found.length >= 2) {
    left = found[0];
    right = found[found.length - 1];
  }
  return { left, right };
}
