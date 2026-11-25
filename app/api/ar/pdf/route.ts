import { buildArPdf, type ArPdfInput } from "@/lib/ar/pdf";
import { loadRaster } from "@/lib/extract";
import { downloadName } from "@/lib/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function asPng(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (file.type.includes("png") || bytes[0] === 0x89) return bytes;
  if (file.type.includes("jpeg") || (bytes[0] === 0xff && bytes[1] === 0xd8)) return bytes;
  const canvas = await loadRaster(bytes);
  return canvas.toBuffer("image/png");
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const payload = form.get("payload");
  if (!(file instanceof File) || typeof payload !== "string") {
    return Response.json({ error: "The report file and the accomplishment text are both required." }, { status: 400 });
  }
  try {
    const body = JSON.parse(payload) as Omit<ArPdfInput, "sections"> & {
      sections: { heading: string; bullets: { text: string; children: string[]; imageKeys: string[] }[] }[];
    };
    const images = new Map<string, Buffer>();
    for (const entry of form.getAll("images")) {
      if (!(entry instanceof File)) continue;
      images.set(entry.name, await asPng(entry));
    }
    const input: ArPdfInput = {
      ...body,
      sections: body.sections.map((section) => ({
        heading: section.heading,
        bullets: section.bullets.map((bullet) => ({
          text: bullet.text,
          children: bullet.children,
          images: bullet.imageKeys.map((key) => images.get(key)).filter((image): image is Buffer => Boolean(image)),
        })),
      })),
    };
    const pdf = await buildArPdf(Buffer.from(await file.arrayBuffer()), file.type || "application/pdf", input);
    const filename = downloadName("AR", body.name, body.period);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build the accomplishment report.";
    return Response.json({ error: message }, { status: 422 });
  }
}
