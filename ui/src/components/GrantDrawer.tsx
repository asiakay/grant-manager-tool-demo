import { Component, useEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { Grant } from "../types";
import type { UserProfile } from "../api";
import { updateNotes, summarizeGrant, type GrantSummary } from "../api";

class DrawerErrorBoundary extends Component<{ children: ReactNode }, { caught: boolean; message: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { caught: false, message: "" };
  }
  static getDerivedStateFromError(err: unknown) {
    return { caught: true, message: err instanceof Error ? err.message : "An unexpected error occurred." };
  }
  componentDidCatch(_err: unknown, _info: ErrorInfo) {
    // Intentionally silent — the fallback UI below is the user-facing signal.
  }
  render() {
    if (this.state.caught) {
      return (
        <div className="p-5 text-center space-y-3">
          <p className="text-red-400 text-sm font-medium">Something went wrong displaying this grant.</p>
          <p className="text-gray-500 text-xs">{this.state.message}</p>
          <button
            type="button"
            className="btn-ghost text-xs px-3 py-1.5"
            onClick={() => this.setState({ caught: false, message: "" })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { FOCUS_AREA_KEYWORDS, ORG_TYPE_KEYWORDS, STAGE_KEYWORDS } from "../rankingKeywords";
import EligibilitySimulator from "./EligibilitySimulator";

interface Props {
  grant: Grant | null;
  onClose: () => void;
  onGrantUpdated: (name: string, notes: string) => void;
  watchlist: Set<string>;
  candidates: Set<string>;
  onToggleWatchlist: (name: string) => void;
  onToggleCandidate: (name: string) => void;
  profile?: UserProfile | null;
  username?: string;
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

// Structured Grants.gov fields — only rendered when present, so CSV-sourced
// grants without them don't show a grid of empty "—" boxes.
const GRANTS_GOV_COLUMNS: (keyof Grant)[] = [
  "Opportunity Number",
  "CFDA Numbers",
  "Eligible Applicants",
  "Award Ceiling",
  "Award Floor",
];

function formatAward(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  return Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

interface RankingRationale {
  headline: string;
  strengths: string[];
  caveats: string[];
}

function grantText(grant: Grant): string {
  return [
    grant.Name,
    grant.Sponsor,
    grant.Benefits,
    grant["Eligibility (key conditions)"],
    grant["Region/Eligibility"],
    grant.Type,
    grant["Notes/Actions"],
  ].join(" ").toLowerCase();
}

function buildRankingRationale(grant: Grant, profile?: UserProfile | null): RankingRationale {
  const score = grant.score ?? parseFloat(String(grant["Weighted Score"]));
  const relevance = parseFloat(String(grant.Relevance));
  const fit = parseFloat(String(grant.Fit));
  const ease = parseFloat(String(grant.Ease));
  const cadence = String(grant.Cadence || "").toLowerCase();
  const deadline = String(grant["Deadline/Next Cohort"] || "");
  const nonDilutive = String(grant["Non-dilutive?"] || "").toLowerCase();

  const strengths: string[] = [];
  const caveats: string[] = [];

  const hasProfile = profile && (
    (Array.isArray(profile.focusAreas) && profile.focusAreas.length > 0) ||
    profile.orgType || profile.stage
  );

  let headline = "This grant was ranked based on funding quality scores.";

  if (hasProfile) {
    if (!isNaN(score)) {
      if (score >= 7) headline = "Strong match — this grant aligns closely with your profile and priorities.";
      else if (score >= 4) headline = "Moderate match — this grant meets several of your criteria.";
      else headline = "Lower match — this grant has limited alignment with your current profile.";
    }

    const text = grantText(grant);

    // Focus area matches — require ≥2 keyword hits to avoid false positives from
    // generic words like "community" appearing in unrelated grant text.
    const focusAreas = Array.isArray(profile!.focusAreas) ? profile!.focusAreas : [];
    const matchedAreas: string[] = [];
    const missedAreas: string[] = [];
    for (const area of focusAreas) {
      const kws = FOCUS_AREA_KEYWORDS[area] || [];
      const hits = kws.filter((kw) => text.includes(kw));
      if (hits.length >= 2) {
        matchedAreas.push(`${area} (via: ${hits.slice(0, 3).join(", ")})`);
      } else if (hits.length === 1) {
        // Weak single-keyword hit — surface as a caveat so user can verify
        caveats.push(`Weak signal for ${area} — only one keyword matched (${hits[0]})`);
      } else {
        missedAreas.push(area);
      }
    }
    if (matchedAreas.length > 0) {
      for (const area of matchedAreas) {
        strengths.push(`Matches your ${area} focus area`);
      }
    }
    if (missedAreas.length > 0 && matchedAreas.length === 0) {
      caveats.push(`No clear match for your ${missedAreas.join(" or ")} focus area${missedAreas.length > 1 ? "s" : ""}`);
    }

    // Org type match — single keyword hit is acceptable here since org-type keywords are more specific
    if (profile!.orgType) {
      const orgKws = ORG_TYPE_KEYWORDS[profile!.orgType] || [];
      const hits = orgKws.filter((kw) => text.includes(kw));
      if (hits.length > 0) {
        strengths.push(`Mentions ${profile!.orgType} eligibility (via: ${hits[0]})`);
      } else {
        caveats.push(`No explicit mention of ${profile!.orgType} eligibility — verify requirements`);
      }
    }

    // Stage match
    if (profile!.stage) {
      const stageKws = STAGE_KEYWORDS[profile!.stage] || [];
      const hits = stageKws.filter((kw) => text.includes(kw));
      if (hits.length > 0) {
        strengths.push(`Aligned with your ${profile!.stage} stage (via: ${hits[0]})`);
      } else {
        caveats.push(`Grant text doesn't clearly reference your ${profile!.stage} stage`);
      }
    }
  } else {
    // No profile — explain using raw score values
    if (!isNaN(score)) {
      if (score >= 2) headline = "Strong quality scores across relevance, fit, and ease.";
      else if (score >= 1) headline = "Moderate quality scores — set a profile for a personalised ranking.";
      else headline = "Lower quality scores — consider setting a profile for better matches.";
    }
    if (!isNaN(relevance)) {
      if (relevance >= 2) strengths.push(`High relevance score (${relevance.toFixed(1)}/3)`);
      else if (relevance < 1) caveats.push(`Low relevance score (${relevance.toFixed(1)}/3)`);
    }
    if (!isNaN(fit)) {
      if (fit >= 2) strengths.push(`Broad eligibility (Fit: ${fit.toFixed(1)}/3)`);
      else if (fit < 1) caveats.push(`Narrow eligibility (Fit: ${fit.toFixed(1)}/3)`);
    }
  }

  // Ease — shown regardless of profile
  if (!isNaN(ease)) {
    if (ease >= 2) strengths.push("Straightforward application process");
    else if (ease < 1) caveats.push(`Application may be complex (Ease: ${ease.toFixed(1)}/3)`);
  }

  // Deadline / cadence
  if (cadence.includes("rolling")) {
    strengths.push("Rolling deadline — apply anytime");
  } else if (deadline) {
    const d = new Date(deadline);
    if (!isNaN(d.getTime())) {
      const daysUntil = (d.getTime() - Date.now()) / 86400000;
      if (daysUntil > 0 && daysUntil <= 60) strengths.push("Deadline approaching soon — act quickly");
      else if (daysUntil < 0) caveats.push("Deadline has passed — check for future cycles");
    }
  }

  // Non-dilutive
  if (nonDilutive === "yes" || nonDilutive === "true") {
    strengths.push("Non-dilutive funding (no equity required)");
  }

  return { headline, strengths, caveats };
}

function ScoreBadge({ value }: { value: string | number }) {
  const n = parseFloat(String(value));
  if (isNaN(n)) return <span className="text-gray-400" aria-label="No score">—</span>;
  const color =
    n >= 7
      ? "bg-green-900/50 text-green-300"
      : n >= 4
        ? "bg-yellow-900/50 text-yellow-300"
        : "bg-red-900/50 text-red-300";
  const level = n >= 7 ? "high" : n >= 4 ? "medium" : "low";
  return (
    <span className={`badge ${color} font-semibold text-sm px-2 py-0.5`} aria-label={`${n.toFixed(1)}, ${level}`}>
      <span aria-hidden="true">{n.toFixed(1)}</span>
    </span>
  );
}

export default function GrantDrawer({ grant, onClose, onGrantUpdated, watchlist, candidates, onToggleWatchlist, onToggleCandidate, profile, username }: Props) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [liveSummary, setLiveSummary] = useState<GrantSummary | null>(null);
  const [summarizeError, setSummarizeError] = useState("");
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (grant) {
      setNotes(String(grant["Notes/Actions"] || ""));
      setSaved(false);
      setSaveError("");
      setLiveSummary(null);
      setSummarizeError("");
      // Move focus into the drawer when it opens
      setTimeout(() => closeBtnRef.current?.focus(), 50);
    }
  }, [grant]);

  async function handleSummarize() {
    if (!grant || !grant["Source URL"]) return;
    setSummarizing(true);
    setSummarizeError("");
    setLiveSummary(null);
    try {
      const result = await summarizeGrant(String(grant["Source URL"]));
      setLiveSummary(result);
    } catch (err) {
      setSummarizeError(err instanceof Error ? err.message : "Summarization failed");
    } finally {
      setSummarizing(false);
    }
  }

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
        aria-hidden="true"
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-200 ${grant ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        aria-label={grant ? `Grant details: ${grant.Name}` : "Grant details"}
        className={`fixed z-50 bg-gray-900 border-gray-800 flex flex-col transition-transform duration-300 ease-out bottom-0 left-0 right-0 h-[90vh] rounded-t-2xl border-t sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:w-full sm:max-w-xl sm:rounded-none sm:border-t-0 sm:border-l ${grant ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:translate-y-0 sm:translate-x-full"}`}
      >
        {grant && (
          <>
            {/* Drag handle (mobile only) */}
            <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0" aria-hidden="true">
              <div className="w-10 h-1 bg-gray-600 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b border-gray-800">
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="badge bg-gray-800 text-gray-300 text-xs">{grant.Type || "—"}</span>
                  <ScoreBadge value={grant.score ?? grant["Weighted Score"]} />
                  {grant["Is Forecast"] && (
                    <span
                      className="badge bg-purple-900/40 text-purple-300 border border-purple-700/40 text-xs"
                      title="Announced by the agency but not yet formally posted"
                    >
                      🔭 Forecasted{grant["Estimated Post Date"] ? ` — expected ${grant["Estimated Post Date"]}` : ""}
                    </span>
                  )}
                </div>
                <h2 id="drawer-title" className="text-lg font-semibold text-white leading-snug">{grant.Name}</h2>
                <p className="text-gray-400 text-sm">{grant.Sponsor}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {(() => {
                  const name = String(grant.Name);
                  const isCandidate = candidates.has(name);
                  const isWatchlisted = watchlist.has(name);
                  return (
                    <>
                      <button
                        aria-label={isCandidate ? "Remove from candidates" : "Mark as candidate"}
                        aria-pressed={isCandidate}
                        onClick={() => onToggleCandidate(name)}
                        className={`p-1.5 rounded transition-colors text-lg leading-none ${isCandidate ? "text-brand-400" : "text-gray-600 hover:text-gray-400"}`}
                      >
                        <span aria-hidden="true">★</span>
                      </button>
                      <button
                        aria-label={isWatchlisted ? "Remove from watchlist" : "Add to watchlist"}
                        aria-pressed={isWatchlisted}
                        onClick={() => onToggleWatchlist(name)}
                        className={`p-1.5 rounded transition-colors text-base leading-none ${isWatchlisted ? "text-blue-400" : "text-gray-600 hover:text-gray-400"}`}
                      >
                        <span aria-hidden="true">👁</span>
                      </button>
                    </>
                  );
                })()}
                <button ref={closeBtnRef} onClick={onClose} className="btn-ghost p-1.5 ml-1" aria-label="Close grant details">
                  <svg className="w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <DrawerErrorBoundary>
              {/* Source URL + Summarize */}
              {grant["Source URL"] && (
                <div className="flex items-center gap-3 flex-wrap">
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
                  <button
                    type="button"
                    onClick={handleSummarize}
                    disabled={summarizing}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label="Summarize this grant using AI"
                  >
                    {summarizing ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                        Summarizing…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Summarize
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Live summary result */}
              {(liveSummary || summarizeError) && (
                <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
                  <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">AI Summary</p>
                  {summarizeError && (
                    <p className="text-red-400 text-sm">{summarizeError}</p>
                  )}
                  {liveSummary && (
                    <>
                      <p className="text-gray-300 text-sm leading-snug">{liveSummary.summary}</p>
                      {liveSummary.bullets.length > 0 && (
                        <ul className="space-y-1 pt-1">
                          {liveSummary.bullets.map((b: string, i: number) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                              <span className="text-brand-400 shrink-0 mt-0.5" aria-hidden="true">•</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Ranking Rationale */}
              {(() => {
                const { headline, strengths, caveats } = buildRankingRationale(grant, profile);
                return (
                  <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
                    <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Why This Ranking</p>
                    <p className="text-gray-300 text-sm">{headline}</p>
                    {(strengths.length > 0 || caveats.length > 0) && (
                      <ul className="space-y-1 pt-1">
                        {strengths.map((s) => (
                          <li key={s} className="flex items-start gap-2 text-sm text-green-300">
                            <span aria-hidden="true" className="mt-0.5 shrink-0">✓</span>
                            <span>{s}</span>
                          </li>
                        ))}
                        {caveats.map((c) => (
                          <li key={c} className="flex items-start gap-2 text-sm text-yellow-300">
                            <span aria-hidden="true" className="mt-0.5 shrink-0">⚠</span>
                            <span>{c}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}

              {/* AI Summary + Tier */}
              {(grant.ai_tier || grant.ai_summary) && (
                <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
                  <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">AI Assessment</p>
                  {grant.ai_tier && (
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${
                      grant.ai_tier === "Hot"
                        ? "bg-orange-900/40 text-orange-300 border border-orange-700/40"
                        : grant.ai_tier === "Warm"
                        ? "bg-yellow-900/40 text-yellow-300 border border-yellow-700/40"
                        : "bg-gray-700/60 text-gray-400 border border-gray-600/40"
                    }`}>
                      {grant.ai_tier}
                    </span>
                  )}
                  {grant.ai_summary && (
                    <p className="text-gray-300 text-sm leading-snug">{grant.ai_summary}</p>
                  )}
                  {grant.ai_score != null && (
                    <p className="text-gray-500 text-xs">AI score: {Number(grant.ai_score).toFixed(1)} / 10</p>
                  )}
                </div>
              )}

              {/* Eligibility Simulator */}
              {profile && (
                <EligibilitySimulator
                  grant={grant}
                  profile={profile}
                  username={username ?? "guest"}
                />
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
                      <ScoreBadge value={col === "Weighted Score" ? (grant.score ?? grant["Weighted Score"]) : (grant[col] as string | number ?? "")} />
                    ) : (
                      <p className="text-gray-200 text-sm leading-snug">
                        {String(grant[col] || "—")}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Grants.gov structured fields (opportunity number, CFDA, award range, eligibility) */}
              {GRANTS_GOV_COLUMNS.some((col) => grant[col] != null && grant[col] !== "") && (
                <div className="grid grid-cols-2 gap-3">
                  {GRANTS_GOV_COLUMNS.filter((col) => grant[col] != null && grant[col] !== "").map((col) => (
                    <div
                      key={col as string}
                      className={`bg-gray-800/50 rounded-lg p-3 ${col === "Eligible Applicants" ? "col-span-2" : ""}`}
                    >
                      <p className="text-gray-500 text-xs font-medium mb-1">{col as string}</p>
                      <p className="text-gray-200 text-sm leading-snug">
                        {col === "Award Ceiling" || col === "Award Floor"
                          ? formatAward(grant[col] as number | string | null)
                          : String(grant[col] || "—")}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Notes editor */}
              <div>
                <label htmlFor="grant-notes" className="block text-sm font-medium text-gray-300 mb-2">
                  Notes / Actions
                </label>
                <textarea
                  id="grant-notes"
                  className="input resize-none h-28 leading-relaxed"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes, next steps, or action items…"
                />
                {saveError && (
                  <p className="text-red-400 text-xs mt-1">{saveError}</p>
                )}
              </div>
              </DrawerErrorBoundary>
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
