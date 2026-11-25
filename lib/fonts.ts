import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts } from "pdf-lib";

const REGULAR = "/System/Library/Fonts/Supplemental/Times New Roman.ttf";
const BOLD = "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf";
const MONO = "/System/Library/Fonts/Supplemental/Courier New.ttf";
const INTER = path.join(process.cwd(), "assets/fonts/Inter-Regular.ttf");
const INTER_BOLD = path.join(process.cwd(), "assets/fonts/Inter-Bold.ttf");

export async function embedInter(pdf: PDFDocument, bold = false) {
  try {
    pdf.registerFontkit(fontkit);
    const bytes = await readFile(bold ? INTER_BOLD : INTER);
    return await pdf.embedFont(bytes, { subset: true });
  } catch {
    return pdf.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  }
}

export async function embedMono(pdf: PDFDocument) {
  try {
    pdf.registerFontkit(fontkit);
    const bytes = await readFile(MONO);
    return await pdf.embedFont(bytes);
  } catch {
    return pdf.embedFont(StandardFonts.Courier);
  }
}

export async function embedSerif(pdf: PDFDocument, bold = false) {
  try {
    pdf.registerFontkit(fontkit);
    const bytes = await readFile(bold ? BOLD : REGULAR);
    return await pdf.embedFont(bytes);
  } catch {
    return pdf.embedFont(bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman);
  }
}
