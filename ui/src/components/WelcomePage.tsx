import { useState } from "react";
import type { UserProfile } from "../api";
import ProfileSetup from "./ProfileSetup";

const FOCUS_LABEL: Record<string, string> = {
  "Health & Medicine": "Health & Medicine",
  "Education & Workforce": "Education & Workforce",
  "Technology & Innovation": "Technology & Innovation",
  "Housing & Community": "Housing & Community",
  "Environment & Climate": "Environment & Climate",
  "Agriculture & Food": "Agriculture & Food",
  "Social Services": "Social Services",
  "Arts & Humanities": "Arts & Humanities",
  "International Development": "International Development",
  "Veterans & Military": "Veterans & Military",
  "Research & Science": "Research & Science",
  "Justice & Safety": "Justice & Safety",
};

const ORG_LABEL: Record<string, string> = {
  nonprofit: "Nonprofit / NGO",
  university: "University / Research Institution",
  startup: "Startup / Small Business",
  government: "Government / Tribal",
  individual: "Individual Researcher",
  hospital: "Hospital / Health System",
};

const STAGE_LABEL: Record<string, string> = {
  research: "Early Research / Ideation",
  pilot: "Pilot / Proof of Concept",
  growth: "Growth / Scaling",
  established: "Established Program",
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

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">

        {/* Welcome header */}
        <div className="text-center">
          <div className="text-5xl mb-4">💰</div>
          <h1 className="text-3xl font-bold text-white">Welcome back, {username}!</h1>
          <p className="text-gray-400 mt-2">Your grant matches are ready based on your profile.</p>
        </div>

        {/* Profile summary card */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Your Profile</h2>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >
              Edit parameters
            </button>
          </div>

          {/* Focus areas */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Focus Areas</p>
            <div className="flex flex-wrap gap-2">
              {profile.focusAreas.length > 0 ? profile.focusAreas.map((area) => (
                <span key={area} className="badge bg-brand-600/20 text-brand-300 border border-brand-700/50">
                  {FOCUS_LABEL[area] ?? area}
                </span>
              )) : <span className="text-gray-500 text-sm">None selected</span>}
            </div>
          </div>

          {/* Org type & Stage */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Organization</p>
              <p className="text-sm text-gray-300">{(ORG_LABEL[profile.orgType] ?? profile.orgType) || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Stage</p>
              <p className="text-sm text-gray-300">{(STAGE_LABEL[profile.stage] ?? profile.stage) || "—"}</p>
            </div>
          </div>
        </div>

        {/* CTA */}
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
