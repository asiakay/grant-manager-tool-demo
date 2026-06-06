import { useState } from "react";
import type { UserProfile } from "../api";

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
  { value: "nonprofit", label: "Nonprofit / NGO" },
  { value: "university", label: "University / Research Institution" },
  { value: "startup", label: "Startup / Small Business" },
  { value: "government", label: "Government / Tribal" },
  { value: "individual", label: "Individual Researcher" },
  { value: "hospital", label: "Hospital / Health System" },
];

const STAGES = [
  { value: "research", label: "Early Research / Ideation" },
  { value: "pilot", label: "Pilot / Proof of Concept" },
  { value: "growth", label: "Growth / Scaling" },
  { value: "established", label: "Established Program" },
];

interface Props {
  initial?: UserProfile | null;
  onSave: (profile: UserProfile) => void;
  onSkip?: () => void;
  saving?: boolean;
}

export default function ProfileSetup({ initial, onSave, onSkip, saving }: Props) {
  const [focusAreas, setFocusAreas] = useState<string[]>(initial?.focusAreas ?? []);
  const [orgType, setOrgType] = useState(initial?.orgType ?? "");
  const [stage, setStage] = useState(initial?.stage ?? "");

  function toggleFocus(area: string) {
    setFocusAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ focusAreas, orgType, stage });
  }

  const isValid = focusAreas.length > 0 && orgType && stage;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🎯</div>
          <h1 className="text-2xl font-bold text-white">Set up your profile</h1>
          <p className="text-gray-400 text-sm mt-1">
            Help us match grants to your specific context
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-6">
          {/* Focus areas */}
          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              Focus areas
              <span className="ml-1 text-gray-500 font-normal">(select all that apply)</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {FOCUS_AREAS.map((area) => {
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
            <label className="block text-sm font-semibold text-white mb-3">
              Organization type
            </label>
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
            <label className="block text-sm font-semibold text-white mb-3">
              Current stage
            </label>
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
              type="submit"
              disabled={!isValid || saving}
              className="btn-primary flex-1 justify-center py-2.5"
            >
              {saving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving…
                </>
              ) : (
                "Save profile & find matches"
              )}
            </button>
            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="btn-ghost px-4"
              >
                Skip
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
