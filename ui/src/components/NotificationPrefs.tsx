import { useEffect, useState } from "react";
import { fetchNotificationPrefs, saveNotificationPrefs } from "../api";
import type { NotificationPrefs } from "../api";

interface Props {
  onClose: () => void;
}

const DAYS_OPTIONS = [3, 5, 7, 14, 30];

export default function NotificationPrefsModal({ onClose }: Props) {
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    reminders_enabled: 0,
    days_before: 7,
    remind_deadlines: 1,
    remind_periods: 1,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchNotificationPrefs()
      .then(setPrefs)
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await saveNotificationPrefs(prefs);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function toggle(key: keyof NotificationPrefs) {
    setPrefs((p) => ({ ...p, [key]: p[key] ? 0 : 1 }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full sm:max-w-md bg-gray-900 rounded-t-2xl sm:rounded-xl shadow-2xl border border-gray-700/50">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <h2 className="text-base font-semibold text-white">Deadline Reminders</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Master toggle */}
              <label className="flex items-center justify-between cursor-pointer gap-4">
                <div>
                  <p className="text-sm font-medium text-white">Enable email reminders</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Receive an email before upcoming grant deadlines and reporting periods
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={!!prefs.reminders_enabled}
                  onClick={() => toggle("reminders_enabled")}
                  className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${
                    prefs.reminders_enabled ? "bg-brand-500" : "bg-gray-700"
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    prefs.reminders_enabled ? "translate-x-5" : ""
                  }`} />
                </button>
              </label>

              {/* Settings (shown only when enabled) */}
              {!!prefs.reminders_enabled && (
                <div className="space-y-4 pl-0">
                  {/* Days before */}
                  <div>
                    <p className="text-sm font-medium text-white mb-2">Remind me this many days before</p>
                    <div className="flex gap-2 flex-wrap">
                      {DAYS_OPTIONS.map((d) => (
                        <button
                          key={d}
                          onClick={() => setPrefs((p) => ({ ...p, days_before: d }))}
                          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                            prefs.days_before === d
                              ? "bg-brand-600 border-brand-500 text-white"
                              : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
                          }`}
                        >
                          {d} {d === 1 ? "day" : "days"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* What to remind about */}
                  <div>
                    <p className="text-sm font-medium text-white mb-2">Remind me about</p>
                    <div className="space-y-2">
                      {[
                        { key: "remind_deadlines" as const, label: "Grant application deadlines", desc: "From matched grants in the Dashboard" },
                        { key: "remind_periods" as const,   label: "Reporting period due dates",  desc: "From applications you're tracking" },
                      ].map(({ key, label, desc }) => (
                        <label key={key} className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!prefs[key]}
                            onChange={() => toggle(key)}
                            className="mt-0.5 accent-brand-500"
                          />
                          <div>
                            <p className="text-sm text-white">{label}</p>
                            <p className="text-xs text-gray-400">{desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="bg-gray-800/60 rounded-lg px-3 py-2.5 text-xs text-gray-400 border border-gray-700/50">
                    Emails are sent to your account email once per day. You can also set per-grant overrides from the grant detail view.
                  </div>
                </div>
              )}

              {/* Save */}
              <div className="flex items-center gap-3 pt-1">
                <button onClick={onClose} className="flex-1 btn-secondary py-2 text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 btn-primary py-2 text-sm font-semibold"
                >
                  {saved ? "Saved ✓" : saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
