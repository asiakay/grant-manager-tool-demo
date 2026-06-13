import { useState } from "react";
import type { UserProfile, MissionAnalysis } from "../api";
import { DEFAULT_WEIGHTS, analyzeMission } from "../api";

// ── Step 1 data ────────────────────────────────────────────────────────────

const FOCUS_AREAS = [
  "Health & Medicine",
  "Education & Workforce",
  "Technology & Innovation",
  "Housing & Community",
  "Environment & Climate",
  "Agriculture & Food",
  "Social Services",
  "Arts & Humanities",
  "International Development",
  "Veterans & Military",
  "Research & Science",
  "Justice & Safety",
];

const ORG_TYPES = [
  { value: "nonprofit",   label: "Nonprofit / NGO" },
  { value: "university",  label: "University / Research Institution" },
  { value: "startup",     label: "Startup / Small Business" },
  { value: "government",  label: "Government / Tribal" },
  { value: "individual",  label: "Individual Researcher" },
  { value: "hospital",    label: "Hospital / Health System" },
];

const STAGES = [
  { value: "research",    label: "Early Research / Ideation" },
  { value: "pilot",       label: "Pilot / Proof of Concept" },
  { value: "growth",      label: "Growth / Scaling" },
  { value: "established", label: "Established Program" },
];

// Maps full AI-returned labels → short form values used by the app
const ORG_TYPE_LABEL_TO_VALUE: Record<string, string> = {
  "Nonprofit/NGO":                   "nonprofit",
  "University/Research Institution": "university",
  "Startup/Small Business":          "startup",
  "Government/Tribal":               "government",
  "Individual Researcher":           "individual",
  "Hospital/Health System":          "hospital",
};

const STAGE_LABEL_TO_VALUE: Record<string, string> = {
  "Early Research / Ideation": "research",
  "Pilot / Proof of Concept":  "pilot",
  "Growth / Scaling":          "growth",
  "Established Program":       "established",
};

// ── Step 2 data ────────────────────────────────────────────────────────────

const WEIGHT_FIELDS: { key: keyof UserProfile["weights"]; label: string; description: string }[] = [
  { key: "Relevance",      label: "Relevance",       description: "How well the grant aligns with your mission" },
  { key: "Fit",            label: "Fit",              description: "How suitable you are as an applicant" },
  { key: "Ease",           label: "Ease",             description: "How straightforward the application process is" },
  { key: "StackAlignment", label: "Stack Alignment",  description: "Whether the sponsor's tech stack is required" },
  { key: "CadenceRecency", label: "Deadline Urgency", description: "How soon the deadline is (rolling = highest)" },
];

const PRESETS: { label: string; weights: UserProfile["weights"] }[] = [
  { label: "Balanced",       weights: DEFAULT_WEIGHTS },
  { label: "Mission-first",  weights: { Relevance: 0.5,  Fit: 0.3,  Ease: 0.1,  StackAlignment: 0.05, CadenceRecency: 0.05 } },
  { label: "Easy wins",      weights: { Relevance: 0.2,  Fit: 0.2,  Ease: 0.5,  StackAlignment: 0.05, CadenceRecency: 0.05 } },
  { label: "Deadline-driven",weights: { Relevance: 0.25, Fit: 0.25, Ease: 0.15, StackAlignment: 0.1,  CadenceRecency: 0.25 } },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function normalize(raw: UserProfile["weights"]): UserProfile["weights"] {
  const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  return {
    Relevance:      raw.Relevance / total,
    Fit:            raw.Fit / total,
    Ease:           raw.Ease / total,
    StackAlignment: raw.StackAlignment / total,
    CadenceRecency: raw.CadenceRecency / total,
  };
}

function toSliders(w: UserProfile["weights"]): UserProfile["weights"] {
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return {
    Relevance:      Math.round((w.Relevance / total) * 100),
    Fit:            Math.round((w.Fit / total) * 100),
    Ease:           Math.round((w.Ease / total) * 100),
    StackAlignment: Math.round((w.StackAlignment / total) * 100),
    CadenceRecency: Math.round((w.CadenceRecency / total) * 100),
  };
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  initial?: UserProfile | null;
  onSave: (profile: UserProfile) => void;
  onSkip?: () => void;
  saving?: boolean;
}

export default function ProfileSetup({ initial, onSave, onSkip, saving }: Props) {
  const [step, setStep] = useState<1 | 2>(1);

  // Mission analysis state
  const [mission, setMission]           = useState(initial?.mission ?? "");
  const [analyzing, setAnalyzing]       = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [rationale, setRationale]       = useState("");

  // Step 1 state
  const [focusAreas, setFocusAreas] = useState<string[]>(initial?.focusAreas ?? []);
  const [orgType, setOrgType]       = useState(initial?.orgType ?? "");
  const [stage, setStage]           = useState(initial?.stage ?? "");

  // Step 2 state (sliders 0-100)
  const [sliders, setSliders] = useState<UserProfile["weights"]>(
    toSliders(initial?.weights ?? DEFAULT_WEIGHTS)
  );

  function toggleFocus(area: string) {
    setFocusAreas(prev =>
      prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]
    );
  }

  function applyPreset(w: UserProfile["weights"]) {
    setSliders(toSliders(w));
  }

  function setSlider(key: keyof UserProfile["weights"], value: number) {
    setSliders(prev => ({ ...prev, [key]: value }));
  }

  async function handleAnalyze() {
    if (mission.trim().length < 20) return;
    setAnalyzing(true);
    setAnalyzeError("");
    setRationale("");
    try {
      const result: MissionAnalysis = await analyzeMission(mission);
      if (result.focusAreas?.length) setFocusAreas(result.focusAreas);
      if (result.orgType) setOrgType(ORG_TYPE_LABEL_TO_VALUE[result.orgType] ?? "");
      if (result.stage)   setStage(STAGE_LABEL_TO_VALUE[result.stage] ?? "");
      if (result.rationale) setRationale(result.rationale);
    } catch {
      setAnalyzeError("Analysis failed — please fill in your profile manually.");
    } finally {
      setAnalyzing(false);
    }
  }

  const step1Valid = focusAreas.length > 0 && orgType && stage;
  const totalPct   = Object.values(sliders).reduce((a, b) => a + b, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ focusAreas, orgType, stage, mission: mission.trim() || undefined, weights: normalize(sliders) });
  }

  // ── Step indicator ──────────────────────────────────────────────────────

  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2].map(n => (
        <div key={n} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
            step === n ? "bg-brand-500 text-white" : n < step ? "bg-brand-800 text-brand-300" : "bg-gray-800 text-gray-500"
          }`}>
            {n < step ? "✓" : n}
          </div>
          <span className={`text-xs ${step === n ? "text-white" : "text-gray-500"}`}>
            {n === 1 ? "Your context" : "Scoring weights"}
          </span>
          {n < 2 && <div className="w-8 h-px bg-gray-700 mx-1" />}
        </div>
      ))}
    </div>
  );

  // ── Step 1 ──────────────────────────────────────────────────────────────

  if (step === 1) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
        <div className="w-full max-w-lg">
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">🎯</div>
            <h1 className="text-2xl font-bold text-white">Tell us about yourself</h1>
            <p className="text-gray-400 text-sm mt-1">This helps us understand your context</p>
          </div>

          <StepIndicator />

          <div className="card space-y-6">
            {/* Mission statement analyzer */}
            <div className="border border-gray-700 rounded-lg p-4 space-y-3 bg-gray-800/30">
              <div>
                <label htmlFor="mission-input" className="block text-sm font-semibold text-white mb-1">
                  Generate from mission statement
                  <span className="ml-2 text-xs font-normal text-gray-400">optional</span>
                </label>
                <p className="text-xs text-gray-500 mb-2">Paste your org's mission and we'll suggest matching focus areas, org type, and stage.</p>
                <textarea
                  id="mission-input"
                  className="input resize-none h-24 leading-relaxed text-sm"
                  value={mission}
                  onChange={(e) => setMission(e.target.value)}
                  placeholder="e.g. We are a nonprofit that advances health equity through community-based clinical research and workforce training…"
                />
              </div>
              {analyzeError && <p className="text-red-400 text-xs">{analyzeError}</p>}
              {rationale && (
                <p className="text-xs text-brand-300 bg-brand-900/20 border border-brand-800 rounded px-3 py-2">
                  {rationale} — Review the suggestions below and adjust as needed.
                </p>
              )}
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analyzing || mission.trim().length < 20}
                className="btn-outline text-sm py-1.5 px-4 flex items-center gap-2"
              >
                {analyzing ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-gray-400/30 border-t-gray-300 rounded-full animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  "Analyze mission →"
                )}
              </button>
            </div>

            {/* Focus areas */}
            <div>
              <label className="block text-sm font-semibold text-white mb-3">
                Focus areas
                <span className="ml-1 text-gray-500 font-normal">(select all that apply)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {FOCUS_AREAS.map(area => {
                  const active = focusAreas.includes(area);
                  return (
                    <button
                      key={area}
                      type="button"
                      onClick={() => toggleFocus(area)}
                      className={`text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                        active
                          ? "bg-brand-600/30 border-brand-500 text-brand-300"
                          : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                      }`}
                    >
                      {area}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Org type */}
            <div>
              <label className="block text-sm font-semibold text-white mb-3">Organization type</label>
              <div className="grid grid-cols-2 gap-2">
                {ORG_TYPES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setOrgType(value)}
                    className={`text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                      orgType === value
                        ? "bg-brand-600/30 border-brand-500 text-brand-300"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Stage */}
            <div>
              <label className="block text-sm font-semibold text-white mb-3">Current stage</label>
              <div className="grid grid-cols-2 gap-2">
                {STAGES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStage(value)}
                    className={`text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                      stage === value
                        ? "bg-brand-600/30 border-brand-500 text-brand-300"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!step1Valid}
                className="btn-primary flex-1 justify-center py-2.5"
              >
                Next: Scoring weights →
              </button>
              {onSkip && (
                <button type="button" onClick={onSkip} className="btn-ghost px-4">Skip</button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2 ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">⚖️</div>
          <h1 className="text-2xl font-bold text-white">Tune your scoring</h1>
          <p className="text-gray-400 text-sm mt-1">Adjust how much each factor matters when ranking grants</p>
        </div>

        <StepIndicator />

        <form onSubmit={handleSubmit} className="card space-y-6">
          {/* Presets */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Quick presets</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.weights)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:border-brand-500 hover:text-brand-300 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sliders */}
          <div className="space-y-5">
            {WEIGHT_FIELDS.map(({ key, label, description }) => {
              const pct   = sliders[key] as number;
              const share = totalPct > 0 ? Math.round((pct / totalPct) * 100) : 0;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-sm font-medium text-white">{label}</span>
                      <p className="text-xs text-gray-500">{description}</p>
                    </div>
                    <span className="text-sm font-semibold text-brand-300 ml-4 w-10 text-right shrink-0">
                      {share}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={pct}
                    onChange={e => setSlider(key, Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-gray-700 accent-brand-500 cursor-pointer"
                  />
                </div>
              );
            })}
          </div>

          {totalPct === 0 && (
            <p className="text-xs text-yellow-400">Set at least one weight above zero.</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-ghost px-4"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={totalPct === 0 || saving}
              className="btn-primary flex-1 justify-center py-2.5"
            >
              {saving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving…
                </>
              ) : (
                "Save & find my matches"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
