import { useState } from "react";

interface Props {
  username: string;
  hasProfile: boolean;
  onFinish: () => void;
  onGoToProfile: () => void;
}

interface Step {
  icon: string;
  title: string;
  subtitle: string;
  bullets: string[];
  tip?: string;
}

const STEPS: Step[] = [
  {
    icon: "🎯",
    title: "Welcome to Grant Manager",
    subtitle: "Your all-in-one tool for finding, applying, and reporting on grants.",
    bullets: [
      "Discover grants ranked by how well they match your organization",
      "Track every application from first draft to funded",
      "Log outputs and outcomes to stay ready for funder reports",
    ],
    tip: "Takes about 2 minutes to set up — let's go.",
  },
  {
    icon: "⚖️",
    title: "Your Profile Powers the Rankings",
    subtitle: "Grant scores are personalized based on your context and priorities.",
    bullets: [
      "Tell us your organization type, stage, and focus areas",
      "Set how much you value relevance, ease, deadline urgency, and more",
      "Grants are re-ranked instantly whenever your profile changes",
    ],
    tip: "You already set this up — you can refine it anytime from the Dashboard.",
  },
  {
    icon: "🔍",
    title: "Find Your Best Matches",
    subtitle: "The Dashboard surfaces grants most likely to be a good fit for you.",
    bullets: [
      "Filter by type, stage, award size, or deadline",
      "Save grants to your watchlist to compare later",
      "Use the AI chat to ask questions about any grant",
    ],
    tip: "Start by browsing the top-scored grants — they update as new ones are added.",
  },
  {
    icon: "📋",
    title: "Track Every Application",
    subtitle: "From applied → offered → funded, keep the full lifecycle in one place.",
    bullets: [
      "Log your logic model: inputs, activities, outputs, and outcomes",
      "Set a reporting schedule — monthly, quarterly, or annual",
      "Submit actuals for each period to track progress against targets",
    ],
    tip: "Start tracking even before a grant is awarded — most fields are optional.",
  },
];

const CHECKLIST_ITEMS = [
  { key: "account",  label: "Create your account" },
  { key: "profile",  label: "Set up your profile" },
  { key: "matches",  label: "Browse grant matches" },
  { key: "track",    label: "Track your first application" },
] as const;

type ChecklistKey = typeof CHECKLIST_ITEMS[number]["key"];

export function loadChecklist(username: string): Record<ChecklistKey, boolean> {
  try {
    const raw = localStorage.getItem(`gmob_${username}`);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      account: true,
      profile: saved.profile ?? false,
      matches: saved.matches ?? false,
      track:   saved.track ?? false,
    };
  } catch {
    return { account: true, profile: false, matches: false, track: false };
  }
}

export function markChecklist(username: string, key: Exclude<ChecklistKey, "account">, value = true) {
  try {
    const current = loadChecklist(username);
    const next = { ...current, [key]: value };
    localStorage.setItem(`gmob_${username}`, JSON.stringify(next));
  } catch { /* ignore */ }
}

export default function Onboarding({ username, hasProfile, onFinish, onGoToProfile }: Props) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  function advance() {
    if (isLast) {
      onFinish();
    } else {
      setStep((s) => s + 1);
    }
  }

  function handleSetUpProfile() {
    onGoToProfile();
  }

  const checklist = loadChecklist(username);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">

        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
            <span>Step {step + 1} of {STEPS.length}</span>
            <button
              onClick={onFinish}
              className="hover:text-gray-300 transition-colors"
            >
              Skip intro
            </button>
          </div>
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Card */}
        <div className="card space-y-5">

          {/* Icon + heading */}
          <div className="text-center">
            <div className="text-5xl mb-4">{current.icon}</div>
            <h1 className="text-2xl font-bold text-white leading-snug">{current.title}</h1>
            <p className="text-gray-400 mt-2 text-sm leading-relaxed">{current.subtitle}</p>
          </div>

          {/* Bullets */}
          <ul className="space-y-3">
            {current.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-gray-300">
                <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-brand-500/20 text-brand-400 flex items-center justify-center text-xs font-bold">
                  {i + 1}
                </span>
                {b}
              </li>
            ))}
          </ul>

          {/* Tip */}
          {current.tip && (
            <div className="bg-gray-800/60 rounded-lg px-4 py-3 text-xs text-gray-400 border border-gray-700/50">
              <span className="text-brand-400 font-semibold">Tip: </span>{current.tip}
            </div>
          )}

          {/* Step 2 CTA: fix profile if not set */}
          {step === 1 && !hasProfile && (
            <button
              onClick={handleSetUpProfile}
              className="w-full btn-secondary text-sm py-2"
            >
              Set up profile first
            </button>
          )}

          {/* Navigation */}
          <div className="flex items-center gap-3 pt-1">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex-none text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                ← Back
              </button>
            )}
            <button
              onClick={advance}
              className="flex-1 btn-primary py-2.5 text-sm font-semibold"
            >
              {isLast ? "Go to Dashboard →" : "Next →"}
            </button>
          </div>
        </div>

        {/* Checklist summary */}
        <div className="mt-4 card">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Your progress</p>
          <ul className="space-y-2">
            {CHECKLIST_ITEMS.map(({ key, label }) => {
              const done = checklist[key];
              return (
                <li key={key} className="flex items-center gap-2.5 text-sm">
                  <span className={`flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center text-xs
                    ${done ? "bg-brand-500 border-brand-500 text-white" : "border-gray-600 text-transparent"}`}>
                    ✓
                  </span>
                  <span className={done ? "text-gray-300 line-through" : "text-gray-400"}>{label}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-2 mt-4">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`w-2 h-2 rounded-full transition-colors ${i === step ? "bg-brand-500" : "bg-gray-700"}`}
              aria-label={`Step ${i + 1}`}
            />
          ))}
        </div>

      </div>
    </div>
  );
}
