import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedSerif } from "../fonts";
import { readLetterhead } from "./letterhead";
import type { Section } from "./format";

export type ArPdfInput = {
  name: string;
  position: string;
  project: string;
  bureau: string;
  period: string;
  intro: string;
  sections: (Omit<Section, "bullets"> & {
    bullets: { text: string; children: string[]; images: Buffer[] }[];
  })[];
  submittedName: string;
  submittedTitle: string;
  approvedName: string;
  approvedTitle: string;
};

type Block =
  | { kind: "intro" | "heading" | "parent" | "child"; text: string; height: number }
  | { kind: "image"; bytes: Buffer; height: number; width: number };

const BLUE = rgb(0.12, 0.27, 0.55);
const INK = rgb(0.08, 0.08, 0.08);

function plain(text: string) {
  return text
    .replace(/[●○•◦]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x00-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function buildArPdf(bytes: Buffer, mime: string, input: ArPdfInput) {
  const frame = await readLetterhead(bytes, mime);
  const pdf = await PDFDocument.create();
  const regular = await embedSerif(pdf);
  const bold = await embedSerif(pdf, true);
  const headerImage = await pdf.embedPng(frame.header);
  const footerImage = await pdf.embedPng(frame.footer);
  const pageWidth = 612;
  const pageHeight = 792;
  const contentWidth = frame.right - frame.left - 28;
  const blocks = await measure(pdf, input, regular, bold, contentWidth);
  const metaHeight = 120;
  const signatureHeight = 78;
  const firstRoom = frame.bottom - frame.top - metaHeight - 16;
  const nextRoom = frame.bottom - frame.top - 24;
  const pages: Block[][] = [];
  let room = firstRoom;
  let bucket: Block[] = [];
  for (const block of blocks) {
    if (bucket.length && block.height > room) {
      pages.push(bucket);
      bucket = [];
      room = nextRoom;
    }
    bucket.push(block);
    room -= block.height;
  }
  if (bucket.length) pages.push(bucket);
  if (!pages.length) pages.push([]);

  const lastIndex = pages.length - 1;
  const lastRoom = lastIndex === 0 ? firstRoom : nextRoom;
  const overflow: Block[] = [];
  while (
    pages[lastIndex].reduce((sum, block) => sum + block.height, 0) + signatureHeight > lastRoom &&
    pages[lastIndex].length > 1
  ) {
    const moved = pages[lastIndex].pop();
    if (moved) overflow.unshift(moved);
  }
  if (overflow.length) pages.push(overflow);

  const total = pages.length;
  for (let index = 0; index < pages.length; index += 1) {
    const blocksOnPage = pages[index];
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(headerImage, {
      x: 0,
      y: pageHeight - frame.headerHeight,
      width: pageWidth,
      height: frame.headerHeight,
    });
    page.drawImage(footerImage, { x: 0, y: 0, width: pageWidth, height: frame.footerHeight });
    page.drawText(`Monthly AR | Page ${index + 1} of ${total}`, {
      x: frame.right - 148,
      y: 28,
      size: 8,
      font: regular,
      color: BLUE,
    });
    page.drawRectangle({
      x: frame.left,
      y: pageHeight - frame.bottom,
      width: frame.right - frame.left,
      height: frame.bottom - frame.top,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    let cursor = frame.top + 12;
    if (index === 0) cursor = drawMeta(page, bold, regular, input, frame.left, frame.right, cursor);
    for (const block of blocksOnPage) {
      cursor = await drawBlock(page, pdf, bold, regular, block, frame.left + 14, contentWidth, cursor);
    }
    if (index === total - 1) drawSignature(page, bold, regular, input, frame, pageHeight);
  }

  return Buffer.from(await pdf.save());
}

async function measure(pdf: PDFDocument, input: ArPdfInput, regular: PDFFont, bold: PDFFont, width: number) {
  const blocks: Block[] = [];
  const pushText = (
    kind: "intro" | "heading" | "parent" | "child",
    text: string,
    font: PDFFont,
    size: number,
    wrapWidth: number,
    extra: number,
  ) => {
    const lines = wrap(text, font, size, wrapWidth);
    blocks.push({ kind, text, height: lines.length * (size + 3) + extra });
  };
  if (plain(input.intro)) pushText("intro", plain(input.intro), bold, 11, width, 8);
  for (const section of input.sections) {
    if (plain(section.heading)) pushText("heading", plain(section.heading), bold, 11, width, 8);
    for (const bullet of section.bullets) {
      if (plain(bullet.text)) pushText("parent", plain(bullet.text), regular, 10.5, width - 16, 4);
      for (const child of bullet.children) {
        if (plain(child)) pushText("child", plain(child), regular, 10.5, width - 34, 2);
      }
      for (const image of bullet.images) {
        const embedded = image[0] === 0xff ? await pdf.embedJpg(image) : await pdf.embedPng(image);
        const maxWidth = width - 16;
        const scale = Math.min(maxWidth / embedded.width, 150 / embedded.height, 1);
        blocks.push({
          kind: "image",
          bytes: image,
          width: embedded.width * scale,
          height: embedded.height * scale + 8,
        });
      }
    }
  }
  return blocks;
}

function drawMeta(
  page: PDFPage,
  bold: PDFFont,
  regular: PDFFont,
  input: ArPdfInput,
  left: number,
  right: number,
  cursor: number,
) {
  const width = right - left;
  const mid = left + width / 2;
  center(page, "MONTHLY ACCOMPLISHMENT REPORT", bold, 12, left, width, cursor);
  cursor += 20;
  center(page, plain(input.period), regular, 11, left, width, cursor);
  cursor += 18;
  rule(page, left, right, cursor);
  cursor += 4;
  field(page, bold, regular, "NAME:", plain(input.name), left + 8, cursor);
  field(page, bold, regular, "POSITION/SG:", plain(input.position), mid + 8, cursor);
  page.drawLine({ start: { x: mid, y: 792 - cursor + 2 }, end: { x: mid, y: 792 - cursor - 14 }, thickness: 0.6, color: INK });
  cursor += 16;
  rule(page, left, right, cursor);
  cursor += 4;
  field(page, bold, regular, "PROJECT:", plain(input.project), left + 8, cursor);
  field(page, bold, regular, "BUREAU:", plain(input.bureau), mid + 8, cursor);
  page.drawLine({ start: { x: mid, y: 792 - cursor + 2 }, end: { x: mid, y: 792 - cursor - 14 }, thickness: 0.6, color: INK });
  cursor += 16;
  rule(page, left, right, cursor);
  return cursor + 10;
}

async function drawBlock(
  page: PDFPage,
  pdf: PDFDocument,
  bold: PDFFont,
  regular: PDFFont,
  block: Block,
  x: number,
  width: number,
  cursor: number,
) {
  if (block.kind === "image") return drawImage(page, pdf, block, x, cursor);
  const font = block.kind === "parent" || block.kind === "child" ? regular : bold;
  const size = block.kind === "heading" || block.kind === "intro" ? 11 : 10.5;
  const indent = block.kind === "parent" ? 14 : block.kind === "child" ? 32 : 0;
  const lines = wrap(plain(block.text), font, size, width - indent);
  lines.forEach((line, index) => {
    if ((block.kind === "parent" || block.kind === "child") && index === 0) {
      const radius = block.kind === "parent" ? 1.8 : 1.7;
      const cx = x + indent - 8;
      const cy = 792 - cursor - 4;
      if (block.kind === "parent") page.drawCircle({ x: cx, y: cy, size: radius, color: INK });
      else page.drawCircle({ x: cx, y: cy, size: radius, borderWidth: 0.7, borderColor: INK, color: rgb(1, 1, 1) });
    }
    page.drawText(line, { x: x + indent, y: 792 - cursor - size, size, font, color: INK });
    cursor += size + 3;
  });
  const extra = block.kind === "child" ? 2 : block.kind === "intro" || block.kind === "heading" ? 8 : 4;
  return cursor + extra;
}

async function drawImage(
  page: PDFPage,
  pdf: PDFDocument,
  block: Extract<Block, { kind: "image" }>,
  x: number,
  cursor: number,
) {
  const embedded = block.bytes[0] === 0xff ? await pdf.embedJpg(block.bytes) : await pdf.embedPng(block.bytes);
  page.drawImage(embedded, { x: x + 14, y: 792 - cursor - (block.height - 8), width: block.width, height: block.height - 8 });
  return cursor + block.height;
}

function drawSignature(page: PDFPage, bold: PDFFont, regular: PDFFont, input: ArPdfInput, frame: { left: number; right: number; bottom: number }, pageHeight: number) {
  const top = frame.bottom - 74;
  const y = pageHeight - top;
  page.drawLine({
    start: { x: frame.left, y: y + 62 },
    end: { x: frame.right, y: y + 62 },
    thickness: 0.8,
    color: INK,
  });
  const mid = (frame.left + frame.right) / 2;
  page.drawLine({ start: { x: mid, y: y + 62 }, end: { x: mid, y: pageHeight - frame.bottom }, thickness: 0.6, color: INK });
  signColumn(page, bold, regular, "SUBMITTED BY:", input.submittedName, input.submittedTitle, frame.left + 10, y);
  signColumn(page, bold, regular, "APPROVED BY:", input.approvedName, input.approvedTitle, mid + 10, y);
}

function signColumn(page: PDFPage, bold: PDFFont, regular: PDFFont, label: string, name: string, title: string, x: number, y: number) {
  page.drawText(label, { x, y: y + 46, size: 9, font: bold, color: INK });
  page.drawLine({ start: { x, y: y + 28 }, end: { x: x + 170, y: y + 28 }, thickness: 0.6, color: INK });
  if (plain(name)) page.drawText(plain(name), { x, y: y + 14, size: 10, font: bold, color: INK });
  if (plain(title)) page.drawText(plain(title), { x, y: y + 2, size: 9, font: regular, color: INK });
}

function field(page: PDFPage, bold: PDFFont, regular: PDFFont, label: string, value: string, x: number, cursor: number) {
  page.drawText(label, { x, y: 792 - cursor - 11, size: 10, font: bold, color: INK });
  const labelWidth = bold.widthOfTextAtSize(label, 10);
  page.drawText(value, { x: x + labelWidth + 4, y: 792 - cursor - 11, size: 10, font: regular, color: INK });
}

function center(page: PDFPage, text: string, font: PDFFont, size: number, left: number, width: number, cursor: number) {
  const textWidth = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: left + (width - textWidth) / 2, y: 792 - cursor - size, size, font, color: INK });
}

function rule(page: PDFPage, left: number, right: number, cursor: number) {
  page.drawLine({ start: { x: left, y: 792 - cursor }, end: { x: right, y: 792 - cursor }, thickness: 0.7, color: INK });
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
