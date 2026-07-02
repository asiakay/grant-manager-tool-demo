import { useEffect, useMemo, useState } from "react";
import type { Grant } from "../types";
import type { UserProfile } from "../api";
import { ORG_TYPE_KEYWORDS, STAGE_KEYWORDS } from "../rankingKeywords";

type EligibilityStatus = "pass" | "fail" | "unknown";

interface EligibilityRequirement {
  id: string;
  text: string;
  autoStatus: EligibilityStatus;
}

interface Props {
  grant: Grant;
  profile: UserProfile;
  username: string;
}

const GEO_TERMS = ["us-based", "u.s.", "united states", "us citizen", "us resident", "domestic", "american"];

function parseFragments(text: string): string[] {
  if (!text || text.trim() === "" || text.trim() === "—") return [];
  let parts: string[];
  if (text.includes(";")) {
    parts = text.split(";");
  } else if (/[\n\r]/.test(text)) {
    parts = text.split(/[\n\r]+/);
  } else if (text.includes(",") && text.length > 60) {
    parts = text.split(",");
  } else {
    parts = [text];
  }
  return parts
    .map((p) => p.replace(/^[\s\-•·*\d.]+/, "").trim())
    .filter((p) => p.length > 3);
}

function detectStatus(fragment: string, profile: UserProfile): EligibilityStatus {
  const lower = fragment.toLowerCase();

  if (GEO_TERMS.some((t) => lower.includes(t))) return "unknown";

  // Nonprofit shorthand
  if (lower.includes("nonprofit") || lower.includes("501(c)") || lower.includes("501c")) {
    return profile.orgType.toLowerCase().includes("nonprofit") ? "pass" : "fail";
  }

  // Org type: check profile match first
  const profileOrgKws = ORG_TYPE_KEYWORDS[profile.orgType] ?? [];
  if (profileOrgKws.some((kw) => lower.includes(kw))) return "pass";

  // Org type: check for exclusionary other-type mention
  for (const [otherType, kws] of Object.entries(ORG_TYPE_KEYWORDS)) {
    if (otherType === profile.orgType) continue;
    if (kws.some((kw) => lower.includes(kw))) return "fail";
  }

  // Stage: profile match
  const profileStageKws = STAGE_KEYWORDS[profile.stage] ?? [];
  if (profileStageKws.some((kw) => lower.includes(kw))) return "pass";

  // Stage mismatch is ambiguous — don't hard-fail
  return "unknown";
}

function storageKey(grantName: string, username: string): string {
  return `gm_eligibility:${encodeURIComponent(grantName)}:${encodeURIComponent(username)}`;
}

function loadStored(key: string): { overrides: Record<string, EligibilityStatus | null>; collapsed: boolean } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { overrides: {}, collapsed: false };
    return JSON.parse(raw);
  } catch {
    return { overrides: {}, collapsed: false };
  }
}

const OVERRIDE_CYCLE: (EligibilityStatus | null)[] = [null, "pass", "fail", "unknown"];

function nextOverride(current: EligibilityStatus | null): EligibilityStatus | null {
  const idx = OVERRIDE_CYCLE.indexOf(current);
  return OVERRIDE_CYCLE[(idx + 1) % OVERRIDE_CYCLE.length];
}

const STATUS_ICON: Record<EligibilityStatus, string> = { pass: "✓", fail: "✗", unknown: "?" };
const STATUS_COLOR: Record<EligibilityStatus, string> = {
  pass: "text-green-400",
  fail: "text-red-400",
  unknown: "text-gray-400",
};
const STATUS_BADGE: Record<EligibilityStatus, string> = {
  pass: "bg-green-900/40 text-green-300",
  fail: "bg-red-900/40 text-red-300",
  unknown: "bg-gray-800 text-gray-400",
};
const STATUS_LABEL: Record<EligibilityStatus, string> = { pass: "Pass", fail: "Fail", unknown: "?" };

export default function EligibilitySimulator({ grant, profile, username }: Props) {
  const key = storageKey(String(grant.Name), username);

  const requirements = useMemo<EligibilityRequirement[]>(() => {
    // Grants.gov-sourced grants carry a structured "Eligible Applicants" list
    // (decoded EligibleApplicantTypes categories) — prefer that over the
    // free-text field, since it needs no heuristic fragment-splitting and is
    // exactly the set of eligible applicant types Grants.gov published.
    const structured = String(grant["Eligible Applicants"] || "").trim();
    const fragments = structured
      ? structured.split(",").map((s) => s.trim()).filter(Boolean)
      : parseFragments(String(grant["Eligibility (key conditions)"] || ""));
    return fragments.map((text, i) => ({
      id: `req-${i}`,
      text,
      autoStatus: detectStatus(text, profile),
    }));
  }, [grant.Name, grant["Eligible Applicants"], grant["Eligibility (key conditions)"], profile]);

  const [overrides, setOverrides] = useState<Record<string, EligibilityStatus | null>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage when grant changes
  useEffect(() => {
    const stored = loadStored(key);
    setOverrides(stored.overrides);
    setCollapsed(stored.collapsed);
    setLoaded(true);
  }, [key]);

  // Save on changes (after initial load)
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(key, JSON.stringify({ overrides, collapsed }));
    } catch { /* quota exceeded */ }
  }, [overrides, collapsed, loaded, key]);

  function toggleOverride(id: string, currentAuto: EligibilityStatus) {
    setOverrides((prev) => {
      const current = prev[id] ?? null;
      const next = nextOverride(current);
      // If cycling back to null (auto), remove the key
      if (next === null) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      // Don't store if it's the same as auto (redundant)
      if (next === currentAuto) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: next };
    });
  }

  if (requirements.length === 0) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-4">
        <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-2">Check Eligibility</p>
        <p className="text-gray-400 text-sm">No structured eligibility conditions found — review the grant source directly.</p>
      </div>
    );
  }

  const resolved = requirements.map((r) => overrides[r.id] ?? r.autoStatus);
  const passCount = resolved.filter((s) => s === "pass").length;
  const failCount = resolved.filter((s) => s === "fail").length;
  const unknownCount = resolved.filter((s) => s === "unknown").length;
  const total = requirements.length;

  const verdict =
    failCount > 0 ? "Needs Review" :
    unknownCount > 0 ? "Partially Eligible" :
    "Likely Eligible";

  const verdictColor =
    verdict === "Likely Eligible" ? "bg-green-900/40 text-green-300" :
    verdict === "Partially Eligible" ? "bg-yellow-900/40 text-yellow-300" :
    "bg-red-900/40 text-red-300";

  return (
    <div className="bg-gray-800/50 rounded-lg p-4 space-y-3">
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between text-left gap-2"
        aria-expanded={!collapsed}
      >
        <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Check Eligibility</span>
        <div className="flex items-center gap-2">
          <span className={`badge text-xs px-2 py-0.5 ${verdictColor}`}>{verdict}</span>
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${collapsed ? "" : "rotate-180"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {!collapsed && (
        <>
          {/* Summary */}
          <p className="text-gray-400 text-xs">
            <span className="text-green-400 font-medium">{passCount}/{total}</span> auto-checked
            {unknownCount > 0 && <> · <span className="text-gray-300">{unknownCount} need{unknownCount === 1 ? "s" : ""} review</span></>}
          </p>

          {/* Requirement rows */}
          <ul className="space-y-2">
            {requirements.map((req) => {
              const resolved = overrides[req.id] ?? req.autoStatus;
              const isOverridden = overrides[req.id] != null;
              return (
                <li key={req.id} className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 w-4 shrink-0 font-bold text-sm ${STATUS_COLOR[resolved]}`}
                    aria-hidden="true"
                  >
                    {STATUS_ICON[resolved]}
                  </span>
                  <span className={`flex-1 text-sm leading-snug ${resolved === "fail" ? "text-red-200" : resolved === "pass" ? "text-gray-200" : "text-gray-400"}`}>
                    {req.text}
                  </span>
                  <button
                    onClick={() => toggleOverride(req.id, req.autoStatus)}
                    title={isOverridden ? "Override active — click to cycle" : "Click to override"}
                    className={`shrink-0 text-xs px-1.5 py-0.5 rounded transition-colors ${STATUS_BADGE[resolved]} ${isOverridden ? "ring-1 ring-white/20" : ""}`}
                  >
                    {STATUS_LABEL[resolved]}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="text-gray-600 text-xs pt-1">Click a status badge to override auto-detection.</p>
        </>
      )}
    </div>
  );
}
