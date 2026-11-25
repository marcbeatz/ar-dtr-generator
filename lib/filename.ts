export function downloadName(kind: "DTR" | "AR", name: string, period: string) {
  const clean = (value: string) =>
    value
      .replace(/[^\w\s,'-]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const person = clean(name) || "Untitled";
  const when = clean(period);
  return when ? `${kind} - ${person} - ${when}.pdf` : `${kind} - ${person}.pdf`;
}
