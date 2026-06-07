import { useState } from "react";
import type { UserProfile } from "../api";
import { DEFAULT_WEIGHTS } from "../api";

const FIELDS: { key: keyof UserProfile["weights"]; label: string; description: string }[] = [
  { key: "Relevance",      label: "Relevance",       description: "How well the grant aligns with your mission" },
  { key: "Fit",            label: "Fit",              description: "How suitable you are as an applicant" },
  { key: "Ease",           label: "Ease",             description: "How straightforward the application process is" },
  { key: "StackAlignment", label: "Stack Alignment",  description: "Whether the sponsor's tech stack is required" },
  { key: "CadenceRecency", label: "Deadline Urgency", description: "How soon the deadline is (rolling = highest)" },
];

const PRESETS: { label: string; weights: UserProfile["weights"] }[] = [
  { label: "Balanced (default)", weights: DEFAULT_WEIGHTS },
  { label: "Mission-first",      weights: { Relevance: 0.5, Fit: 0.3, Ease: 0.1, StackAlignment: 0.05, CadenceRecency: 0.05 } },
  { label: "Easy wins",          weights: { Relevance: 0.2, Fit: 0.2, Ease: 0.5, StackAlignment: 0.05, CadenceRecency: 0.05 } },
  { label: "Deadline-driven",    weights: { Relevance: 0.25, Fit: 0.25, Ease: 0.15, StackAlignment: 0.1, CadenceRecency: 0.25 } },
];

interface Props {
  initial?: UserProfile | null;
  onSave: (profile: UserProfile) => void;
  onSkip?: () => void;
  saving?: boolean;
}

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

export default function ProfileSetup({ initial, onSave, onSkip, saving }: Props) {
  // Store as 0-100 integers for slider UX, normalize on save
  const initialRaw = initial?.weights ?? DEFAULT_WEIGHTS;
  const total0 = Object.values(initialRaw).reduce((a, b) => a + b, 0) || 1;

  const [sliders, setSliders] = useState<UserProfile["weights"]>({
    Relevance:      Math.round((initialRaw.Relevance / total0) * 100),
    Fit:            Math.round((initialRaw.Fit / total0) * 100),
    Ease:           Math.round((initialRaw.Ease / total0) * 100),
    StackAlignment: Math.round((initialRaw.StackAlignment / total0) * 100),
    CadenceRecency: Math.round((initialRaw.CadenceRecency / total0) * 100),
  });

  const totalPct = Object.values(sliders).reduce((a, b) => a + b, 0);

  function setField(key: keyof UserProfile["weights"], value: number) {
    setSliders(prev => ({ ...prev, [key]: value }));
  }

  function applyPreset(weights: UserProfile["weights"]) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    setSliders({
      Relevance:      Math.round((weights.Relevance / total) * 100),
      Fit:            Math.round((weights.Fit / total) * 100),
      Ease:           Math.round((weights.Ease / total) * 100),
      StackAlignment: Math.round((weights.StackAlignment / total) * 100),
      CadenceRecency: Math.round((weights.CadenceRecency / total) * 100),
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ weights: normalize(sliders) });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">⚖️</div>
          <h1 className="text-2xl font-bold text-white">Customize your scoring</h1>
          <p className="text-gray-400 text-sm mt-1">
            Adjust how much each factor matters when ranking grants
          </p>
        </div>

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
            {FIELDS.map(({ key, label, description }) => {
              const pct = sliders[key] as number;
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
                    onChange={e => setField(key, Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-gray-700 accent-brand-500 cursor-pointer"
                  />
                </div>
              );
            })}
          </div>

          {/* Weight total warning */}
          {totalPct === 0 && (
            <p className="text-xs text-yellow-400">Set at least one weight above zero.</p>
          )}

          <div className="flex gap-3 pt-1">
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
            {onSkip && (
              <button type="button" onClick={onSkip} className="btn-ghost px-4">
                Skip
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
