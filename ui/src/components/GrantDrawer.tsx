import { useEffect, useRef, useState } from "react";
import type { Grant } from "../types";
import { updateNotes } from "../api";

interface Props {
  grant: Grant | null;
  onClose: () => void;
  onGrantUpdated: (name: string, notes: string) => void;
}

const COLUMNS: (keyof Grant)[] = [
  "Type",
  "Sponsor",
  "Source URL",
  "Region/Eligibility",
  "Deadline/Next Cohort",
  "Cadence",
  "Benefits",
  "Eligibility (key conditions)",
  "Stage",
  "Non-dilutive?",
  "Stack Required?",
  "Relevance",
  "Fit",
  "Ease",
  "Weighted Score",
];

function ScoreBadge({ value }: { value: string | number }) {
  const n = parseFloat(String(value));
  if (isNaN(n)) return <span className="text-gray-400">—</span>;
  const color =
    n >= 7
      ? "bg-green-900/50 text-green-300"
      : n >= 4
        ? "bg-yellow-900/50 text-yellow-300"
        : "bg-red-900/50 text-red-300";
  return (
    <span className={`badge ${color} font-semibold text-sm px-2 py-0.5`}>{n.toFixed(1)}</span>
  );
}

export default function GrantDrawer({ grant, onClose, onGrantUpdated }: Props) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (grant) {
      setNotes(String(grant["Notes/Actions"] || ""));
      setSaved(false);
      setSaveError("");
    }
  }, [grant]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSave() {
    if (!grant) return;
    setSaving(true);
    setSaveError("");
    try {
      await updateNotes(String(grant.Name), notes);
      onGrantUpdated(String(grant.Name), notes);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const isScoreCol = (col: keyof Grant) =>
    ["Relevance", "Fit", "Ease", "Weighted Score"].includes(col as string);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-200 ${grant ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed right-0 top-0 h-full w-full max-w-xl bg-gray-900 border-l border-gray-800 z-50 flex flex-col transition-transform duration-300 ease-out ${grant ? "translate-x-0" : "translate-x-full"}`}
      >
        {grant && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b border-gray-800">
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="badge bg-gray-800 text-gray-300 text-xs">{grant.Type || "—"}</span>
                  <ScoreBadge value={grant["Weighted Score"]} />
                </div>
                <h2 className="text-lg font-semibold text-white leading-snug">{grant.Name}</h2>
                <p className="text-gray-400 text-sm">{grant.Sponsor}</p>
              </div>
              <button onClick={onClose} className="btn-ghost p-1.5 shrink-0" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Source URL */}
              {grant["Source URL"] && (
                <div>
                  <a
                    href={String(grant["Source URL"])}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-brand-400 hover:text-brand-300 text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    View Source
                  </a>
                </div>
              )}

              {/* Fields grid */}
              <div className="grid grid-cols-2 gap-3">
                {COLUMNS.filter((c) => c !== "Source URL").map((col) => (
                  <div
                    key={col as string}
                    className={`bg-gray-800/50 rounded-lg p-3 ${["Benefits", "Eligibility (key conditions)"].includes(col as string) ? "col-span-2" : ""}`}
                  >
                    <p className="text-gray-500 text-xs font-medium mb-1">{col as string}</p>
                    {isScoreCol(col) ? (
                      <ScoreBadge value={grant[col] ?? ""} />
                    ) : (
                      <p className="text-gray-200 text-sm leading-snug">
                        {String(grant[col] || "—")}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Notes editor */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Notes / Actions
                </label>
                <textarea
                  className="input resize-none h-28 leading-relaxed"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes, next steps, or action items…"
                />
                {saveError && (
                  <p className="text-red-400 text-xs mt-1">{saveError}</p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-gray-800 flex items-center justify-between gap-3">
              <button onClick={onClose} className="btn-outline">
                Close
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary"
              >
                {saving ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving…
                  </>
                ) : saved ? (
                  <>✓ Saved</>
                ) : (
                  "Save Notes"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
