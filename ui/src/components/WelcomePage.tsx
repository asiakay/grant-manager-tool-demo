import { useState } from "react";
import type { UserProfile } from "../api";
import ProfileSetup from "./ProfileSetup";

const FIELD_LABELS: Record<string, string> = {
  Relevance:      "Relevance",
  Fit:            "Fit",
  Ease:           "Ease",
  StackAlignment: "Stack Alignment",
  CadenceRecency: "Deadline Urgency",
};

interface Props {
  username: string;
  profile: UserProfile;
  onViewMatches: () => void;
  onSaveProfile: (p: UserProfile) => Promise<void>;
  saving: boolean;
}

export default function WelcomePage({ username, profile, onViewMatches, onSaveProfile, saving }: Props) {
  const [editing, setEditing] = useState(false);

  async function handleSave(p: UserProfile) {
    await onSaveProfile(p);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 flex items-start justify-center pt-10">
        <div className="w-full max-w-lg">
          <button
            onClick={() => setEditing(false)}
            className="text-gray-400 hover:text-white text-sm mb-4 flex items-center gap-1"
          >
            ← Back
          </button>
          <ProfileSetup initial={profile} onSave={handleSave} saving={saving} />
        </div>
      </div>
    );
  }

  const weights = profile.weights ?? {};
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">

        <div className="text-center">
          <div className="text-5xl mb-4">💰</div>
          <h1 className="text-3xl font-bold text-white">Welcome back, {username}!</h1>
          <p className="text-gray-400 mt-2">Grants are ranked using your custom scoring weights.</p>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Your Scoring Weights</h2>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              Edit weights
            </button>
          </div>

          <div className="space-y-3">
            {Object.entries(weights).map(([key, value]) => {
              const pct = Math.round((value / total) * 100);
              return (
                <div key={key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-300">{FIELD_LABELS[key] ?? key}</span>
                    <span className="text-brand-300 font-semibold">{pct}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <button
          onClick={onViewMatches}
          className="btn-primary w-full justify-center py-3 text-base"
        >
          View my personalized grant matches →
        </button>

      </div>
    </div>
  );
}
