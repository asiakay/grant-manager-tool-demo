import { useState } from "react";
import AdminUpload from "./AdminUpload";
import { scoreGrants, type ScoreGrantsResult } from "../api";

interface Props {
  isAdmin: boolean;
  onBack: () => void;
}

export default function AdminPage({ isAdmin, onBack }: Props) {
  const [uploaded, setUploaded] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [scoreResult, setScoreResult] = useState<ScoreGrantsResult | null>(null);
  const [scoreError, setScoreError] = useState("");

  async function handleScoreGrants(rescore = false) {
    setScoring(true);
    setScoreResult(null);
    setScoreError("");
    try {
      const result = await scoreGrants(rescore, 10);
      setScoreResult(result);
    } catch (e) {
      setScoreError(String(e));
    } finally {
      setScoring(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="btn-ghost gap-1.5 px-2.5"
            aria-label="Back to dashboard"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Dashboard
          </button>
          <h1 className="text-xl font-bold text-white">Admin</h1>
        </div>

        {!isAdmin ? (
          <div className="bg-amber-900/30 border border-amber-700 text-amber-300 rounded-xl px-5 py-4 text-sm">
            You don't have admin access. Contact the site administrator to request it.
          </div>
        ) : (
          <>
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Grant data
            </h2>
            {uploaded && (
              <div className="bg-green-900/30 border border-green-700 text-green-300 rounded-xl px-4 py-3 text-sm">
                Grants updated. Return to the{" "}
                <button onClick={onBack} className="underline hover:text-green-200">
                  dashboard
                </button>{" "}
                to see the changes.
              </div>
            )}
            <AdminUpload
              open={true}
              inline={true}
              onClose={onBack}
              onUploaded={() => setUploaded(true)}
            />

            <div className="border-t border-gray-800 pt-6">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
                AI scoring
              </h2>
              <p className="text-sm text-gray-400 mb-4">
                Score unscored grants using AI. Each batch fetches up to 10 grants, reads their
                source pages, and derives Relevance, Fit, and Ease scores (0–3) automatically.
              </p>
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={() => handleScoreGrants(false)}
                  disabled={scoring}
                  className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
                >
                  {scoring ? "Scoring…" : "Score unscored grants"}
                </button>
                <button
                  onClick={() => handleScoreGrants(true)}
                  disabled={scoring}
                  className="btn-ghost text-sm px-4 py-2 disabled:opacity-50"
                >
                  Re-score all (next 10)
                </button>
              </div>

              {scoreError && (
                <div className="mt-3 bg-red-900/30 border border-red-700 text-red-300 rounded-xl px-4 py-3 text-sm">
                  {scoreError}
                </div>
              )}
              {scoreResult && (
                <div className="mt-3 bg-green-900/30 border border-green-700 text-green-300 rounded-xl px-4 py-3 text-sm space-y-1">
                  <p>Scored {scoreResult.scored} of {scoreResult.total} grants.</p>
                  {scoreResult.errors.length > 0 && (
                    <details className="text-xs text-yellow-300">
                      <summary className="cursor-pointer">{scoreResult.errors.length} error(s)</summary>
                      <ul className="mt-1 space-y-0.5 list-disc list-inside">
                        {scoreResult.errors.map((e, i) => (
                          <li key={i}>{e.name}: {e.error}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
