import { useState, useEffect } from "react";
import { loadChecklist, markChecklist } from "./Onboarding";

interface Props {
  username: string;
  onGoToTracker?: () => void;
}

export default function OnboardingChecklist({ username, onGoToTracker }: Props) {
  const [checklist, setChecklist] = useState(() => loadChecklist(username));
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(`gmob_dismissed_${username}`) === "1"; } catch { return false; }
  });

  // Mark "matches" done once this widget mounts on the dashboard
  useEffect(() => {
    if (!checklist.matches) {
      markChecklist(username, "matches");
      setChecklist(loadChecklist(username));
    }
  }, [username]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = [
    { key: "account" as const, label: "Create your account" },
    { key: "profile" as const, label: "Set up your profile" },
    { key: "matches" as const, label: "Browse grant matches" },
    { key: "track"   as const, label: "Track your first application" },
  ];

  const doneCount = items.filter((i) => checklist[i.key]).length;
  const allDone = doneCount === items.length;

  function dismiss() {
    try { localStorage.setItem(`gmob_dismissed_${username}`, "1"); } catch { /* ignore */ }
    setDismissed(true);
  }

  if (dismissed) return null;
  if (allDone) {
    // Show a brief congratulations then auto-dismiss
    return (
      <div className="fixed bottom-20 right-4 z-40 w-64 card shadow-xl border border-brand-500/30 animate-fade-in">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-white">All set! 🎉</p>
            <p className="text-xs text-gray-400 mt-0.5">You've completed the getting started checklist.</p>
          </div>
          <button onClick={dismiss} className="text-gray-500 hover:text-gray-300 text-lg leading-none flex-shrink-0">×</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-20 right-4 z-40 w-64 shadow-xl">
      {/* Collapsed handle */}
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="w-full card border border-gray-700 flex items-center justify-between text-sm px-3 py-2"
        >
          <span className="text-gray-300 font-medium">Getting started</span>
          <span className="text-xs text-brand-400">{doneCount}/{items.length}</span>
        </button>
      ) : (
        <div className="card border border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Getting started</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-brand-400">{doneCount}/{items.length}</span>
              <button onClick={() => setCollapsed(true)} className="text-gray-500 hover:text-gray-300 text-base leading-none">−</button>
              <button onClick={dismiss} className="text-gray-500 hover:text-gray-300 text-lg leading-none">×</button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-300"
              style={{ width: `${(doneCount / items.length) * 100}%` }}
            />
          </div>

          <ul className="space-y-2">
            {items.map(({ key, label }) => {
              const done = checklist[key];
              const isTrack = key === "track";
              return (
                <li key={key} className="flex items-center gap-2 text-xs">
                  <span className={`flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center text-xs
                    ${done ? "bg-brand-500 border-brand-500 text-white" : "border-gray-600"}`}>
                    {done && "✓"}
                  </span>
                  {isTrack && !done && onGoToTracker ? (
                    <button
                      onClick={onGoToTracker}
                      className="text-brand-400 hover:text-brand-300 underline underline-offset-2 text-left"
                    >
                      {label}
                    </button>
                  ) : (
                    <span className={done ? "text-gray-500 line-through" : "text-gray-300"}>{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
