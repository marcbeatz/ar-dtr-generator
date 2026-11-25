import { openPdf, type PdfTextItem } from "../extract";
import { toNotes, type Section } from "./format";

export type ArDocument = {
  name: string;
  position: string;
  project: string;
  bureau: string;
  period: string;
  intro: string;
  notes: string;
  sections: Section[];
  submittedName: string;
  submittedTitle: string;
  approvedName: string;
  approvedTitle: string;
};

type Line = { text: string; y: number; x: number; end: number };

function linesOf(items: PdfTextItem[]): Line[] {
  const texts = items
    .filter((item) => item.str)
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      end: item.transform[4] + (item.width || item.str.length * 4),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of texts) {
    const last = lines[lines.length - 1];
    const beside = last && Math.abs(last.y - item.y) <= 2.5 && item.x >= last.end - 1 && item.x - last.end < 22;
    if (last && beside) {
      if (last.text && !last.text.endsWith(" ") && !item.text.startsWith(" ")) last.text += " ";
      last.text += item.text;
      last.end = Math.max(last.end, item.end);
    } else {
      lines.push({ text: item.text, y: item.y, x: item.x, end: item.end });
    }
  }
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];
    if (/^[●○•◦]$/.test(line.text) && line.y - next.y < 20 && next.x >= line.x) {
      next.text = `${line.text} ${next.text}`;
      next.x = line.x;
      lines.splice(index, 1);
      index -= 1;
    }
  }
  return lines.map((line) => ({ ...line, text: line.text.replace(/\s+/g, " ").trim() })).filter((line) => line.text);
}

function isFooter(text: string) {
  return /dict headquarters|dict\.gov\.ph|8920 0101|monthly ar\s*\|/i.test(text);
}

function isAllCapsHeading(text: string) {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && text === text.toUpperCase() && text.length <= 36 && !/[.]/.test(text);
}

function isHeading(text: string) {
  if (/^(submitted by|approved by)\b/i.test(text)) return false;
  const letters = text.replace(/[^A-Za-z]/g, "");
  const allCaps = letters.length >= 3 && text === text.toUpperCase() && text.length <= 36;
  const token = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,24}$/.test(text);
  return allCaps || token;
}

function bullet(text: string): { level: "parent" | "child"; text: string } | null {
  const parent = text.match(/^(?:●|•)\s*(.+)$/);
  const child = text.match(/^(?:○|◦)\s*(.+)$/);
  if (child) return { level: "child", text: child[1].trim() };
  if (parent) return { level: "parent", text: parent[1].trim() };
  return null;
}

export async function readArUpload(bytes: Buffer, mime: string): Promise<ArDocument> {
  const isPdf = mime === "application/pdf" || bytes.subarray(0, 4).toString() === "%PDF";
  if (!isPdf) return readArImage(bytes);
  return readAr(bytes);
}

async function readArImage(bytes: Buffer): Promise<ArDocument> {
  const { loadRaster, recognize } = await import("../extract");
  const canvas = await loadRaster(bytes);
  const { PSM } = await import("tesseract.js");
  const result = await recognize(canvas.toBuffer("image/png"), {
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: "",
  });
  const text = result.data.text.replace(/[ \t]+/g, " ");
  const name = text.match(/NAME:\s*(.+?)(?:\n|POSITION)/i)?.[1]?.trim() ?? "";
  if (!name) throw new Error("Could not read the NAME line on this accomplishment report.");
  const position = text.match(/POSITION\/SG:\s*(.+)/i)?.[1]?.trim() ?? "";
  const project = text.match(/PROJECT:\s*(.+?)(?:\n|BUREAU)/i)?.[1]?.trim() ?? "";
  const bureau = text.match(/BUREAU:\s*(.+)/i)?.[1]?.trim() ?? "";
  const period =
    text.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*[-–]\s*\d{1,2},?\s*20\d{2}/i,
    )?.[0] ?? "";
  return {
    name,
    position,
    project,
    bureau,
    period,
    intro: "",
    sections: [],
    notes: "",
    submittedName: "",
    submittedTitle: "",
    approvedName: "",
    approvedTitle: "",
  };
}

export async function readAr(bytes: Buffer): Promise<ArDocument> {
  const doc = await openPdf(new Uint8Array(bytes));
  const pages: Line[][] = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    pages.push(linesOf(content.items).filter((line) => !isFooter(line.text) && line.y > 72));
  }
  const lines = pages.flat();
  const nameLine = lines.find((line) => /NAME\s*:/i.test(line.text));
  const projectLine = lines.find((line) => /PROJECT\s*:/i.test(line.text));
  const nameMatch = nameLine?.text.match(/NAME:\s*(.*?)(?:\s+POSITION\/SG:\s*(.*))?$/i);
  const positionLine = lines.find((line) => /POSITION\/SG\s*:/i.test(line.text) && line !== nameLine);
  const projectMatch = projectLine?.text.match(/PROJECT:\s*(.*?)(?:\s+BUREAU:\s*(.*))?$/i);
  const bureauLine = lines.find((line) => /BUREAU\s*:/i.test(line.text) && line !== projectLine);
  const period = lines.find((line) =>
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(line.text),
  );

  const body: Line[] = [];
  const signature: Line[] = [];
  let signing = false;
  for (const line of lines) {
    if (/^monthly accomplishment report$/i.test(line.text)) continue;
    if (/^(NAME|POSITION\/SG|PROJECT|BUREAU)\s*:/i.test(line.text)) continue;
    if (line === nameLine || line === projectLine || line === positionLine || line === bureauLine || line === period) continue;
    if (/^submitted by\b/i.test(line.text)) signing = true;
    if (signing) signature.push(line);
    else body.push(line);
  }

  const ends = body.map((line) => line.end).sort((a, b) => a - b);
  const rightEdge = ends[Math.floor(ends.length * 0.75)] ?? 520;
  let intro = "";
  let introOpen = true;
  const sections: Section[] = [];
  let current: Section | null = null;
  let last: { kind: "intro" | "parent" | "child"; end: number } | null = null;

  const ensure = () => {
    if (!current) {
      current = { heading: "", bullets: [] };
      sections.push(current);
    }
    return current;
  };

  const append = (text: string) => {
    const extra = text.replace(/\s+/g, " ").trim();
    if (!last) return;
    if (last.kind === "intro") intro = `${intro} ${extra}`.trim();
    if (last.kind === "parent" && current?.bullets.length) {
      const bulletRow = current.bullets[current.bullets.length - 1];
      bulletRow.text = `${bulletRow.text} ${extra}`.trim();
    }
    if (last.kind === "child" && current?.bullets.length) {
      const children = current.bullets[current.bullets.length - 1].children;
      children[children.length - 1] = `${children[children.length - 1]} ${extra}`.trim();
    }
    last.end = Math.max(last.end, 0);
  };

  let carried: "parent" | "child" | null = null;
  for (const line of body) {
    if (/^[●•]$/.test(line.text)) {
      carried = "parent";
      continue;
    }
    if (/^[○◦]$/.test(line.text)) {
      carried = "child";
      continue;
    }
    const marked = bullet(line.text) ?? (carried ? { level: carried, text: line.text } : null);
    carried = null;
    const prior = previousText(last, intro, current);
    const continues =
      !marked &&
      last &&
      !isAllCapsHeading(line.text) &&
      ((/^[a-z(]/.test(line.text) && line.x > 80) || (line.x > 100 && last.end > rightEdge - 42 && !/[:.]$/.test(prior)));
    if (continues && last) {
      append(line.text);
      last.end = line.end;
      continue;
    }
    if (!marked && isHeading(line.text)) {
      introOpen = false;
      current = { heading: line.text, bullets: [] };
      sections.push(current);
      last = null;
      continue;
    }
    if (introOpen && !marked) {
      intro = `${intro} ${line.text}`.replace(/\s+/g, " ").trim();
      last = { kind: "intro", end: line.end };
      continue;
    }
    introOpen = false;
    const section = ensure();
    if (marked?.level === "child" && section.bullets.length) {
      section.bullets[section.bullets.length - 1].children.push(marked.text);
      last = { kind: "child", end: line.end };
      continue;
    }
    section.bullets.push({ text: marked?.text ?? line.text, children: [] });
    last = { kind: "parent", end: line.end };
  }

  const submitted = columnValue(signature, "submitted by");
  const approved = columnValue(signature, "approved by");
  const name = cleanField(nameMatch?.[1] ?? "");
  if (!name) throw new Error("Could not read the NAME line on this accomplishment report.");

  return {
    name,
    position: cleanField(nameMatch?.[2] ?? positionLine?.text.replace(/^.*?POSITION\/SG:\s*/i, "") ?? ""),
    project: cleanField(projectMatch?.[1] ?? ""),
    bureau: cleanField(projectMatch?.[2] ?? bureauLine?.text.replace(/^.*?BUREAU:\s*/i, "") ?? ""),
    period: period?.text ?? "",
    intro,
    sections,
    notes: toNotes(intro, sections),
    submittedName: submitted.name,
    submittedTitle: submitted.title,
    approvedName: approved.name,
    approvedTitle: approved.title,
  };
}

function previousText(
  last: { kind: "intro" | "parent" | "child" } | null,
  intro: string,
  current: Section | null,
) {
  if (!last) return "";
  if (last.kind === "intro") return intro;
  if (!current?.bullets.length) return "";
  const bulletRow = current.bullets[current.bullets.length - 1];
  if (last.kind === "child") return bulletRow.children[bulletRow.children.length - 1] ?? "";
  return bulletRow.text;
}

function cleanField(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function columnValue(lines: Line[], label: string) {
  const labelLine = lines.find((line) => line.text.toLowerCase().startsWith(label));
  const anchor = labelLine?.x ?? (label.startsWith("approved") ? 320 : 48);
  const following = lines.filter((line) => {
    if (/^(submitted by|approved by)\b/i.test(line.text)) return false;
    return Math.abs(line.x - anchor) < 80;
  });
  return { name: following[0]?.text ?? "", title: following[1]?.text ?? "" };
}
