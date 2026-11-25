import { readArUpload } from "@/lib/ar/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Upload a PDF or photo of the accomplishment report." }, { status: 400 });
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const document = await readArUpload(bytes, file.type || "application/pdf");
    return Response.json(document);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read that accomplishment report.";
    return Response.json({ error: message }, { status: 422 });
  }
}
