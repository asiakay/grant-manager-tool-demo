import { useRef, useState } from "react";
import { uploadGrantsCsv } from "../api";
import type { CsvUploadResult } from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

export default function AdminUpload({ open, onClose, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CsvUploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function reset() {
    setFile(null);
    setError("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleUpload() {
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    if (
      mode === "replace" &&
      !window.confirm("Replace mode deletes ALL existing grants before importing. Continue?")
    ) {
      return;
    }
    setUploading(true);
    setError("");
    setResult(null);
    try {
      const res = await uploadGrantsCsv(file, mode);
      setResult(res);
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Admin: upload grants CSV"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="card w-full max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Upload grants CSV</h2>
          <button onClick={handleClose} className="btn-ghost px-2" aria-label="Close">
            ✕
          </button>
        </div>

        <p className="text-sm text-gray-400">
          Add grants in bulk from a CSV file. The header row must include a{" "}
          <code className="text-gray-300">Name</code> column; other recognized columns
          (Type, Sponsor, Source URL, Deadline / Next Cohort, Benefits, Relevance, Fit,
          Ease, …) are matched automatically and unknown columns are ignored.
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="admin-csv-file" className="block text-sm text-gray-300 mb-1">
              CSV file
            </label>
            <input
              id="admin-csv-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="input"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError("");
                setResult(null);
              }}
            />
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm text-gray-300 mb-1">Import mode</legend>
            <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="radio"
                name="upload-mode"
                checked={mode === "merge"}
                onChange={() => setMode("merge")}
                className="mt-0.5"
              />
              <span>
                <strong>Merge</strong> — add new grants and update existing ones (matched by Name)
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="radio"
                name="upload-mode"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
                className="mt-0.5"
              />
              <span>
                <strong className="text-red-300">Replace</strong> — delete all existing grants,
                then import the file
              </span>
            </label>
          </fieldset>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-green-900/30 border border-green-700 text-green-300 rounded-xl px-4 py-3 text-sm space-y-1">
            <p>
              <strong>Import complete:</strong> {result.inserted} added
              {result.mode === "merge" && <>, {result.updated} updated</>}
              {result.skipped > 0 && <>, {result.skipped} skipped (missing Name)</>}.
            </p>
            {result.unknownColumns.length > 0 && (
              <p className="text-green-400/80">
                Ignored unrecognized columns: {result.unknownColumns.join(", ")}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={handleClose} className="btn-outline" disabled={uploading}>
            {result ? "Done" : "Cancel"}
          </button>
          <button onClick={handleUpload} className="btn-primary" disabled={uploading || !file}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
