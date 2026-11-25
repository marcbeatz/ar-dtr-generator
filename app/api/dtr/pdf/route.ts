import { readFile } from "node:fs/promises";
import path from "node:path";
import { fillDays } from "@/lib/dtr/fill";
import { buildDtrPdf } from "@/lib/dtr/pdf";
import { emptyDay, type DayRow, type Period } from "@/lib/dtr/types";
import { downloadIssues } from "@/lib/dtr/validate";
import { downloadName } from "@/lib/filename";
import { monthName, periodFromParts } from "@/lib/period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BLANK_FORM = path.join(process.cwd(), "assets/dtr/form.pdf");

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const payload = form.get("payload");
  if (typeof payload !== "string") {
    return Response.json({ error: "The filled record is required." }, { status: 400 });
  }
  try {
    const body = JSON.parse(payload) as {
      name?: string;
      period?: Period;
      recognized?: DayRow[];
      days?: DayRow[];
      headOfficer?: string;
    };
    const issue = downloadIssues(body.name ?? "", body.period)[0];
    if (issue) return Response.json({ error: issue.message }, { status: 400 });
    const period = periodFromParts(body.period!.month, body.period!.year, body.period!.startDay, body.period!.endDay);
    const days = Array.isArray(body.days) && body.days.length ? body.days : fillDays(body.recognized ?? [], period);
    const uploaded = file instanceof File && file.size > 0 ? file : null;
    const pdf = await buildDtrPdf(
      uploaded ? Buffer.from(await uploaded.arrayBuffer()) : await readFile(BLANK_FORM),
      uploaded ? uploaded.type || "application/pdf" : "application/pdf",
      uploaded ? (body.recognized ?? []) : Array.from({ length: 30 }, (_, day) => emptyDay(day + 1)),
      days,
      period,
      body.headOfficer ?? "",
      uploaded ? undefined : { name: (body.name ?? "").trim(), period: `${monthName(period.month)} ${period.startDay} - ${period.endDay} , ${period.year}` },
    );
    const filename = downloadName("DTR", body.name ?? "", period.label);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build the Daily Time Record.";
    return Response.json({ error: message }, { status: 422 });
  }
}
