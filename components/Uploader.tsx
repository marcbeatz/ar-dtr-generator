"use client";

export function Uploader({
  label,
  detail,
  accept,
  busy,
  onFile,
}: {
  label: string;
  detail: string;
  accept: string;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className="drop">
      <div>
        <strong>{busy ? "Reading the file…" : label}</strong>
        <p>{detail}</p>
        <input
          type="file"
          accept={accept}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </div>
    </label>
  );
}
