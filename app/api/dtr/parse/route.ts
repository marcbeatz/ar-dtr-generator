import { fillDays } from "@/lib/dtr/fill";
import { readDtr } from "@/lib/dtr/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Upload a PDF or photo of the DTR." }, { status: 400 });
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const read = await readDtr(bytes, file.type || "application/pdf");
    return Response.json({ ...read, days: fillDays(read.recognized, read.period) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read that Daily Time Record.";
    return Response.json({ error: message }, { status: 422 });
  }
}
