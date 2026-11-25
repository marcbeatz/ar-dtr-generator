"use client";

import { useMemo, useState } from "react";
import { Uploader } from "./Uploader";
import { formatNotes, type Notes } from "@/lib/ar/format";

type Source = {
  name: string;
  position: string;
  project: string;
  bureau: string;
  period: string;
  notes: string;
  submittedName: string;
  submittedTitle: string;
  approvedName: string;
  approvedTitle: string;
};

type Shot = { id: string; url: string; file: File };

export function ArStudio() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [shots, setShots] = useState<Record<string, Shot[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notes = useMemo(() => formatNotes(source?.notes ?? ""), [source?.notes]);

  async function onFile(next: File) {
    setFile(next);
    setBusy(true);
    setError("");
    setShots({});
    const body = new FormData();
    body.set("file", next);
    const response = await fetch("/api/ar/parse", { method: "POST", body });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) {
      setSource(null);
      setError(json.error ?? "Could not read that file.");
      return;
    }
    setSource({
      name: json.name ?? "",
      position: json.position ?? "",
      project: json.project ?? "",
      bureau: json.bureau ?? "",
      period: json.period ?? "",
      notes: json.notes ?? "",
      submittedName: json.submittedName ?? "",
      submittedTitle: json.submittedTitle ?? "",
      approvedName: json.approvedName ?? "",
      approvedTitle: json.approvedTitle ?? "",
    });
  }

  function setField(field: keyof Source, value: string) {
    if (!source) return;
    setSource({ ...source, [field]: value });
  }

  function addShot(key: string, file: File) {
    const shot = { id: `${key}-${file.name}-${crypto.randomUUID()}`, url: URL.createObjectURL(file), file };
    setShots((current) => ({ ...current, [key]: [...(current[key] ?? []), shot] }));
  }

  async function download() {
    if (!file || !source) return;
    setBusy(true);
    setError("");
    const sections = notes.sections.map((section, sectionIndex) => ({
      heading: section.heading,
      bullets: section.bullets.map((bullet, bulletIndex) => {
        const key = `${sectionIndex}:${bulletIndex}:${bullet.text}`;
        return {
          text: bullet.text,
          children: bullet.children,
          imageKeys: (shots[key] ?? []).map((shot) => shot.id),
        };
      }),
    }));
    const body = new FormData();
    body.set("file", file);
    body.set("payload", JSON.stringify({ ...source, intro: notes.intro, sections }));
    for (const group of Object.values(shots)) {
      for (const shot of group) body.append("images", new File([shot.file], shot.id, { type: shot.file.type }));
    }
    const response = await fetch("/api/ar/pdf", { method: "POST", body });
    setBusy(false);
    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      setError(json.error ?? "Could not build the PDF.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const header = response.headers.get("Content-Disposition") ?? "";
    const match = header.match(/filename\*=UTF-8''([^;]+)/);
    link.href = url;
    link.download = match ? decodeURIComponent(match[1]) : "AR.pdf";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <h1 className="page-title">Accomplishment Report</h1>
      <p className="note">The name comes from the NAME cell above the accomplishment list. Paste notes as a heading, then lines. Indent a line to make it a sub-bullet.</p>
      <Uploader label="Upload an accomplishment report" detail="PDF or photo. The letterhead is kept from this file." accept="application/pdf,image/*" busy={busy} onFile={onFile} />
      {error ? <p className="error">{error}</p> : null}
      {source ? (
        <section className="panel">
          <div className="row">
            <label className="field"><span>Name from the form</span><input value={source.name} onChange={(event) => setField("name", event.target.value)} /></label>
            <label className="field"><span>Position / SG</span><input value={source.position} onChange={(event) => setField("position", event.target.value)} /></label>
            <label className="field"><span>Period</span><input value={source.period} onChange={(event) => setField("period", event.target.value)} /></label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <label className="field"><span>Project</span><input value={source.project} onChange={(event) => setField("project", event.target.value)} /></label>
            <label className="field"><span>Bureau</span><input value={source.bureau} onChange={(event) => setField("bureau", event.target.value)} /></label>
          </div>
          <div className="work" style={{ marginTop: 18 }}>
            <label className="field">
              <span>Accomplishments</span>
              <textarea value={source.notes} onChange={(event) => setField("notes", event.target.value)} />
            </label>
            <Preview notes={notes} shots={shots} onShot={addShot} />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <label className="field"><span>Submitted by</span><input value={source.submittedName} onChange={(event) => setField("submittedName", event.target.value)} /></label>
            <label className="field"><span>Title</span><input value={source.submittedTitle} onChange={(event) => setField("submittedTitle", event.target.value)} /></label>
            <label className="field"><span>Approved by</span><input value={source.approvedName} onChange={(event) => setField("approvedName", event.target.value)} /></label>
            <label className="field"><span>Title</span><input value={source.approvedTitle} onChange={(event) => setField("approvedTitle", event.target.value)} /></label>
          </div>
          <div className="actions">
            <button className="primary" type="button" disabled={busy} onClick={download}>Download PDF</button>
            <span className="note">The signature lines are left blank.</span>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Preview({ notes, shots, onShot }: { notes: Notes; shots: Record<string, Shot[]>; onShot: (key: string, file: File) => void }) {
  return (
    <div className="preview">
      <span className="meta-label">Arranged bullets</span>
      {notes.intro ? <p><strong>{notes.intro}</strong></p> : null}
      {notes.sections.map((section, sectionIndex) => (
        <div className="bullet-block" key={`${section.heading}-${sectionIndex}`}>
          {section.heading ? <h3>{section.heading}</h3> : null}
          <ul>
            {section.bullets.map((bullet, bulletIndex) => {
              const key = `${sectionIndex}:${bulletIndex}:${bullet.text}`;
              return (
                <li key={key}>
                  {bullet.text}
                  {bullet.children.length ? (
                    <ul>{bullet.children.map((child) => <li className="child" key={child}>{child}</li>)}</ul>
                  ) : null}
                  <div className="shots">
                    {(shots[key] ?? []).map((shot) => <img key={shot.id} src={shot.url} alt="" />)}
                  </div>
                  <input type="file" accept="image/*" onChange={(event) => { const next = event.target.files?.[0]; if (next) onShot(key, next); }} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
