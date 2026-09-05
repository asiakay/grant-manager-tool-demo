import { useEffect, useState } from "react";
import {
  fetchTrackerApplications,
  fetchTrackerDetail,
  fetchTrackerDashboard,
  createTrackerApplication,
  updateTrackerApplication,
  addTrackerOkr,
  reviseOkr,
  addKeyResult,
  logActuals,
  type GrantApplication,
  type TrackerDetail,
  type DashboardPeriod,
  type Periodicity,
  type LifecycleStatus,
  type ReportingPeriod,
  type GrantOkr,
} from "../api";

interface Props {
  onBack: () => void;
}

type Tab = "dashboard" | "applications" | "detail";

const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  applied: "Applied",
  offered: "Offered",
  funded: "Funded",
  closed: "Closed",
};

const LIFECYCLE_COLORS: Record<LifecycleStatus, string> = {
  applied: "bg-blue-900/40 text-blue-300",
  offered: "bg-yellow-900/40 text-yellow-300",
  funded: "bg-green-900/40 text-green-300",
  closed: "bg-gray-700 text-gray-400",
};

const PERIOD_COLORS: Record<string, string> = {
  upcoming: "bg-blue-900/40 text-blue-300",
  overdue: "bg-red-900/40 text-red-300",
  submitted: "bg-green-900/40 text-green-300",
};

const KR_STATUS_COLORS: Record<string, string> = {
  met: "text-green-400",
  partial: "text-yellow-400",
  missed: "text-red-400",
};

const KR_STATUS_ICONS: Record<string, string> = {
  met: "✓",
  partial: "~",
  missed: "✗",
};

const PERIODICITY_LABELS: Record<Periodicity, string> = {
  "one-time": "One-time",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  custom: "Custom interval",
};

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function daysUntil(due: string) {
  const diff = Math.round((new Date(due).getTime() - Date.now()) / 86400000);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Due today";
  return `${diff}d away`;
}

// ── New/Edit Application Modal ────────────────────────────────────────────────
interface AppFormProps {
  initial?: Partial<GrantApplication>;
  onSave: (data: Partial<GrantApplication>) => Promise<void>;
  onClose: () => void;
}

function AppForm({ initial, onSave, onClose }: AppFormProps) {
  const [form, setForm] = useState({
    grant_name: initial?.grant_name ?? "",
    funder: initial?.funder ?? "",
    total_awarded: initial?.total_awarded != null ? String(initial.total_awarded) : "",
    application_date: initial?.application_date ?? "",
    offer_date: initial?.offer_date ?? "",
    funded_date: initial?.funded_date ?? "",
    lifecycle_status: initial?.lifecycle_status ?? "applied",
    periodicity: initial?.periodicity ?? "one-time",
    custom_interval_days: initial?.custom_interval_days != null ? String(initial.custom_interval_days) : "",
    period_horizon: initial?.period_horizon != null ? String(initial.period_horizon) : "4",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const update = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.grant_name.trim()) { setErr("Grant name is required."); return; }
    setSaving(true);
    setErr("");
    try {
      await onSave({
        grant_name: form.grant_name.trim(),
        funder: form.funder.trim() || undefined,
        total_awarded: form.total_awarded ? Number(form.total_awarded) : undefined,
        application_date: form.application_date || undefined,
        offer_date: form.offer_date || undefined,
        funded_date: form.funded_date || undefined,
        lifecycle_status: form.lifecycle_status as LifecycleStatus,
        periodicity: form.periodicity as Periodicity,
        custom_interval_days: form.periodicity === "custom" && form.custom_interval_days ? Number(form.custom_interval_days) : undefined,
        period_horizon: form.period_horizon ? Number(form.period_horizon) : 4,
        notes: form.notes.trim() || undefined,
      });
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="relative bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl"
        >✕</button>
        <h2 className="text-lg font-semibold text-white mb-5">
          {initial?.id ? "Edit Grant Application" : "New Grant Application"}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Grant name *</label>
            <input
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              value={form.grant_name}
              onChange={(e) => update("grant_name", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Funder / Sponsor</label>
            <input
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              value={form.funder}
              onChange={(e) => update("funder", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Total awarded ($)</label>
            <input
              type="number"
              min="0"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              value={form.total_awarded}
              onChange={(e) => update("total_awarded", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Application date</label>
            <input
              type="date"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              value={form.application_date}
              onChange={(e) => update("application_date", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Offer date</label>
            <input
              type="date"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              value={form.offer_date}
              onChange={(e) => update("offer_date", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Funded date</label>
            <input
              type="date"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              value={form.funded_date}
              onChange={(e) => update("funded_date", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Lifecycle status</label>
            <select
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              value={form.lifecycle_status}
              onChange={(e) => update("lifecycle_status", e.target.value)}
            >
              {(["applied", "offered", "funded", "closed"] as LifecycleStatus[]).map((s) => (
                <option key={s} value={s}>{LIFECYCLE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Reporting periodicity</label>
            <select
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              value={form.periodicity}
              onChange={(e) => update("periodicity", e.target.value)}
            >
              {(["one-time", "monthly", "quarterly", "annual", "custom"] as Periodicity[]).map((p) => (
                <option key={p} value={p}>{PERIODICITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
          {form.periodicity === "custom" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Interval (days)</label>
              <input
                type="number"
                min="1"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
                value={form.custom_interval_days}
                onChange={(e) => update("custom_interval_days", e.target.value)}
              />
            </div>
          )}
          {form.periodicity !== "one-time" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Periods to generate</label>
              <input
                type="number"
                min="1"
                max="24"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
                value={form.period_horizon}
                onChange={(e) => update("period_horizon", e.target.value)}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <textarea
              rows={2}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500 resize-none"
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
            />
          </div>
        </div>

        {err && <p className="text-red-400 text-xs mt-3">{err}</p>}

        <div className="flex justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-white">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── OKR Modal ─────────────────────────────────────────────────────────────────
interface OkrFormProps {
  appId: number;
  existingOkr?: GrantOkr;
  onSave: () => void;
  onClose: () => void;
}

function OkrForm({ appId, existingOkr, onSave, onClose }: OkrFormProps) {
  const [objective, setObjective] = useState(existingOkr?.objective ?? "");
  const [revisionNotes, setRevisionNotes] = useState("");
  const [krs, setKrs] = useState<{ description: string; target_value: string; unit: string }[]>(
    existingOkr ? [] : [{ description: "", target_value: "", unit: "" }]
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function addKrRow() {
    setKrs((prev) => [...prev, { description: "", target_value: "", unit: "" }]);
  }
  function updateKr(i: number, field: string, val: string) {
    setKrs((prev) => prev.map((kr, idx) => idx === i ? { ...kr, [field]: val } : kr));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!objective.trim()) { setErr("Objective is required."); return; }
    setSaving(true);
    setErr("");
    try {
      if (existingOkr) {
        await reviseOkr(existingOkr.id, { objective: objective.trim(), revision_notes: revisionNotes.trim() || undefined });
        // Add any new key results
        for (const kr of krs) {
          if (!kr.description.trim() || !kr.target_value) continue;
          await addKeyResult(existingOkr.id, {
            description: kr.description.trim(),
            target_value: Number(kr.target_value),
            unit: kr.unit.trim(),
          });
        }
      } else {
        await addTrackerOkr(appId, {
          objective: objective.trim(),
          keyResults: krs
            .filter((kr) => kr.description.trim() && kr.target_value)
            .map((kr) => ({ description: kr.description.trim(), target_value: Number(kr.target_value), unit: kr.unit.trim() })),
        });
      }
      onSave();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="relative bg-gray-900 border border-gray-700 rounded-xl w-full max-w-xl p-6 shadow-2xl"
      >
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">✕</button>
        <h2 className="text-lg font-semibold text-white mb-4">
          {existingOkr ? "Revise OKR" : "Add OKR"}
        </h2>

        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">Objective *</label>
          <textarea
            rows={2}
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500 resize-none"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
        </div>

        {existingOkr && (
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">Revision notes</label>
            <input
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              value={revisionNotes}
              onChange={(e) => setRevisionNotes(e.target.value)}
              placeholder="Why are you revising?"
            />
          </div>
        )}

        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">{existingOkr ? "Add Key Results" : "Key Results"}</span>
            <button type="button" onClick={addKrRow} className="text-xs text-brand-400 hover:text-brand-300">
              + Add row
            </button>
          </div>
          <div className="space-y-2">
            {krs.map((kr, i) => (
              <div key={i} className="grid grid-cols-5 gap-2 items-center">
                <input
                  className="col-span-3 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-brand-500"
                  placeholder="Description"
                  value={kr.description}
                  onChange={(e) => updateKr(i, "description", e.target.value)}
                />
                <input
                  type="number"
                  min="0"
                  className="col-span-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-brand-500"
                  placeholder="Target"
                  value={kr.target_value}
                  onChange={(e) => updateKr(i, "target_value", e.target.value)}
                />
                <input
                  className="col-span-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-brand-500"
                  placeholder="Unit"
                  value={kr.unit}
                  onChange={(e) => updateKr(i, "unit", e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        {err && <p className="text-red-400 text-xs mt-3">{err}</p>}

        <div className="flex justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Log Actuals Modal ─────────────────────────────────────────────────────────
interface LogActualsProps {
  period: ReportingPeriod;
  okrs: GrantOkr[];
  onSave: () => void;
  onClose: () => void;
}

function LogActualsModal({ period, okrs, onSave, onClose }: LogActualsProps) {
  const allKrs = okrs.flatMap((o) => (o.keyResults ?? []).map((kr) => ({ ...kr, objective: o.objective })));
  const [actuals, setActuals] = useState<Record<number, string>>(() =>
    Object.fromEntries(allKrs.map((kr) => [kr.id, kr.actual_value != null ? String(kr.actual_value) : ""]))
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      const payload = Object.entries(actuals)
        .filter(([, v]) => v !== "")
        .map(([id, v]) => ({ key_result_id: Number(id), actual_value: Number(v) }));
      await logActuals(period.id, payload);
      onSave();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="relative bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg p-6 shadow-2xl"
      >
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">✕</button>
        <h2 className="text-lg font-semibold text-white mb-1">Log Actuals</h2>
        <p className="text-xs text-gray-400 mb-4">Reporting period {period.period_number} — due {fmt(period.due_date)}</p>

        {allKrs.length === 0 ? (
          <p className="text-gray-400 text-sm">No key results defined yet. Add OKRs first.</p>
        ) : (
          <div className="space-y-3">
            {allKrs.map((kr) => {
              const val = actuals[kr.id] ?? "";
              const pct = val !== "" && kr.target_value ? ((Number(val) / kr.target_value) * 100).toFixed(0) : null;
              const status = val !== "" ? (Number(val) === 0 ? "missed" : Number(val) / kr.target_value >= 0.97 ? "met" : "partial") : null;
              return (
                <div key={kr.id} className="bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-0.5">{kr.objective}</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm text-white">{kr.description}</p>
                      <p className="text-xs text-gray-500">Target: {kr.target_value} {kr.unit}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-brand-500"
                        value={val}
                        placeholder="Actual"
                        onChange={(e) => setActuals((a) => ({ ...a, [kr.id]: e.target.value }))}
                      />
                      {status && (
                        <span className={`text-sm font-medium ${KR_STATUS_COLORS[status]}`}>
                          {KR_STATUS_ICONS[status]}
                          {pct != null ? ` ${pct}%` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {err && <p className="text-red-400 text-xs mt-3">{err}</p>}

        <div className="flex justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
          <button
            type="submit"
            disabled={saving || allKrs.length === 0}
            className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving…" : "Submit Report"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Detail View ───────────────────────────────────────────────────────────────
interface DetailViewProps {
  appId: number;
  onBack: () => void;
  onRefreshList: () => void;
}

function DetailView({ appId, onBack, onRefreshList }: DetailViewProps) {
  const [detail, setDetail] = useState<TrackerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [okrModalOpen, setOkrModalOpen] = useState(false);
  const [editingOkr, setEditingOkr] = useState<GrantOkr | undefined>();
  const [logPeriod, setLogPeriod] = useState<ReportingPeriod | null>(null);

  async function load() {
    setLoading(true);
    try {
      setDetail(await fetchTrackerDetail(appId));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [appId]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!detail) return <p className="text-gray-400 text-center py-12">Grant not found.</p>;

  const { application: app, okrs, reportingPeriods } = detail;
  const today = new Date().toISOString().slice(0, 10);

  const STEPS: LifecycleStatus[] = ["applied", "offered", "funded", "closed"];
  const currentStep = STEPS.indexOf(app.lifecycle_status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">← Back</button>
        <h2 className="text-xl font-bold text-white flex-1 truncate">{app.grant_name}</h2>
        <button
          onClick={() => setEditOpen(true)}
          className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
        >
          Edit
        </button>
      </div>

      {/* Timeline strip */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-4">Lifecycle Timeline</h3>
        <div className="flex items-center gap-0">
          {STEPS.map((step, i) => {
            const done = i <= currentStep;
            const label = LIFECYCLE_LABELS[step];
            const dateMap: Record<LifecycleStatus, string | null | undefined> = {
              applied: app.application_date,
              offered: app.offer_date,
              funded: app.funded_date,
              closed: null,
            };
            return (
              <div key={step} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center min-w-0">
                  <div
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-bold transition-colors ${
                      done
                        ? "border-brand-500 bg-brand-600 text-white"
                        : "border-gray-600 bg-gray-800 text-gray-500"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </div>
                  <span className={`text-xs mt-1 font-medium ${done ? "text-white" : "text-gray-500"}`}>{label}</span>
                  <span className="text-xs text-gray-500">{fmt(dateMap[step])}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 ${i < currentStep ? "bg-brand-600" : "bg-gray-700"}`} />
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-gray-400">Funder</span>
            <p className="text-white mt-0.5">{app.funder || "—"}</p>
          </div>
          <div>
            <span className="text-gray-400">Total awarded</span>
            <p className="text-white mt-0.5">{app.total_awarded != null ? `$${app.total_awarded.toLocaleString()}` : "—"}</p>
          </div>
          <div>
            <span className="text-gray-400">Periodicity</span>
            <p className="text-white mt-0.5">{PERIODICITY_LABELS[app.periodicity]}{app.custom_interval_days ? ` (${app.custom_interval_days}d)` : ""}</p>
          </div>
          {app.notes && (
            <div className="sm:col-span-1">
              <span className="text-gray-400">Notes</span>
              <p className="text-white mt-0.5 truncate">{app.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Reporting periods */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-3">Reporting Periods</h3>
        {reportingPeriods.length === 0 ? (
          <p className="text-gray-500 text-sm">No reporting periods yet — set a funded date to auto-generate them.</p>
        ) : (
          <div className="space-y-2">
            {reportingPeriods.map((p) => {
              const eff = p.status === "upcoming" && p.due_date < today ? "overdue" : p.status;
              return (
                <div key={p.id} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PERIOD_COLORS[eff]}`}>
                    {eff.charAt(0).toUpperCase() + eff.slice(1)}
                  </span>
                  <span className="text-sm text-white flex-1">Period {p.period_number} — due {fmt(p.due_date)}</span>
                  <span className={`text-xs ${eff === "overdue" ? "text-red-400" : "text-gray-400"}`}>
                    {eff !== "submitted" ? daysUntil(p.due_date) : `Submitted ${fmt(p.submitted_at)}`}
                  </span>
                  {eff !== "submitted" && (
                    <button
                      onClick={() => setLogPeriod(p)}
                      className="text-xs px-3 py-1 bg-brand-700 hover:bg-brand-600 text-white rounded"
                    >
                      Log actuals
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* OKRs */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider">OKRs</h3>
          <button
            onClick={() => { setEditingOkr(undefined); setOkrModalOpen(true); }}
            className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
          >
            + Add OKR
          </button>
        </div>

        {okrs.length === 0 ? (
          <p className="text-gray-500 text-sm">No OKRs yet. Add one to track outcomes for this grant.</p>
        ) : (
          <div className="space-y-4">
            {okrs.map((okr) => (
              <div key={okr.id} className="border border-gray-700 rounded-lg p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{okr.objective}</p>
                    {okr.revision_count > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Revised {okr.revision_count}× — last {fmt(okr.last_revised_at)}
                        {okr.revision_notes ? ` · "${okr.revision_notes}"` : ""}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => { setEditingOkr(okr); setOkrModalOpen(true); }}
                    className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded"
                  >
                    Revise
                  </button>
                </div>
                {(okr.keyResults ?? []).length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {(okr.keyResults ?? []).map((kr, ki) => {
                      // Group actuals by reporting_period_id — show latest
                      const pct = kr.actual_value != null && kr.target_value
                        ? ((kr.actual_value / kr.target_value) * 100).toFixed(0)
                        : null;
                      return (
                        <div key={ki} className="flex items-center gap-3 text-xs text-gray-300">
                          <span className={`w-4 text-center font-bold ${kr.computed_status ? KR_STATUS_COLORS[kr.computed_status] : "text-gray-500"}`}>
                            {kr.computed_status ? KR_STATUS_ICONS[kr.computed_status] : "·"}
                          </span>
                          <span className="flex-1">{kr.description}</span>
                          <span className="text-gray-500">
                            {kr.actual_value != null ? `${kr.actual_value}` : "—"} / {kr.target_value} {kr.unit}
                            {pct != null ? ` (${pct}%)` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 mt-1">No key results yet.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {editOpen && (
        <AppForm
          initial={app}
          onSave={async (data) => {
            await updateTrackerApplication(app.id, data);
            setEditOpen(false);
            await load();
            onRefreshList();
          }}
          onClose={() => setEditOpen(false)}
        />
      )}
      {okrModalOpen && (
        <OkrForm
          appId={appId}
          existingOkr={editingOkr}
          onSave={async () => {
            setOkrModalOpen(false);
            await load();
          }}
          onClose={() => setOkrModalOpen(false)}
        />
      )}
      {logPeriod && (
        <LogActualsModal
          period={logPeriod}
          okrs={okrs}
          onSave={async () => {
            setLogPeriod(null);
            await load();
          }}
          onClose={() => setLogPeriod(null)}
        />
      )}
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────
function DashboardTab({ onSelectApp }: { onSelectApp: (id: number) => void }) {
  const [periods, setPeriods] = useState<DashboardPeriod[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTrackerDashboard()
      .then(setPeriods)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>;

  const overdue = periods.filter((p) => p.effective_status === "overdue");
  const upcoming = periods.filter((p) => p.effective_status === "upcoming");

  return (
    <div className="space-y-6">
      {overdue.length > 0 && (
        <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-red-400 mb-3">Overdue Reports ({overdue.length})</h3>
          <div className="space-y-2">
            {overdue.map((p) => (
              <div key={p.id} className="flex items-center gap-3 bg-gray-900/60 rounded-lg px-4 py-3">
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 font-medium">Overdue</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{p.grant_name}</p>
                  <p className="text-xs text-gray-400">Period {p.period_number} — due {fmt(p.due_date)}</p>
                </div>
                <span className="text-xs text-red-400">{daysUntil(p.due_date)}</span>
                <button
                  onClick={() => onSelectApp(p.grant_application_id)}
                  className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded"
                >
                  View
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">
          {upcoming.length > 0 ? `Upcoming Reports (${upcoming.length})` : "No upcoming reports"}
        </h3>
        {upcoming.length === 0 && overdue.length === 0 && (
          <p className="text-gray-500 text-sm">All reporting periods are submitted or no funded grants yet.</p>
        )}
        <div className="space-y-2">
          {upcoming.map((p) => (
            <div key={p.id} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 font-medium">Upcoming</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{p.grant_name}</p>
                <p className="text-xs text-gray-400">Period {p.period_number} — due {fmt(p.due_date)}</p>
              </div>
              <span className="text-xs text-gray-400">{daysUntil(p.due_date)}</span>
              <button
                onClick={() => onSelectApp(p.grant_application_id)}
                className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded"
              >
                View
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Applications List Tab ─────────────────────────────────────────────────────
interface AppsListTabProps {
  apps: GrantApplication[];
  loading: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
}

function AppsListTab({ apps, loading, onSelect, onNew }: AppsListTabProps) {
  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={onNew}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg"
        >
          + New Application
        </button>
      </div>
      {apps.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-4">No grant applications yet.</p>
          <button
            onClick={onNew}
            className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg"
          >
            + New Application
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => onSelect(app.id)}
              className="w-full text-left bg-gray-900 border border-gray-700 hover:border-gray-500 rounded-xl p-4 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium text-sm truncate">{app.grant_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LIFECYCLE_COLORS[app.lifecycle_status]}`}>
                      {LIFECYCLE_LABELS[app.lifecycle_status]}
                    </span>
                    {(app.overdue_count ?? 0) > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 font-medium">
                        {app.overdue_count} overdue
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {app.funder && <span>{app.funder} · </span>}
                    {PERIODICITY_LABELS[app.periodicity]}
                    {app.total_awarded != null && ` · $${app.total_awarded.toLocaleString()}`}
                  </p>
                </div>
                <div className="text-right text-xs text-gray-500 shrink-0">
                  <p>{(app.okr_count ?? 0)} OKR{(app.okr_count ?? 0) !== 1 ? "s" : ""}</p>
                  <p>{(app.upcoming_count ?? 0)} upcoming</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main GrantTracker ─────────────────────────────────────────────────────────
export default function GrantTracker({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [apps, setApps] = useState<GrantApplication[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [newAppOpen, setNewAppOpen] = useState(false);

  async function loadApps() {
    setAppsLoading(true);
    try {
      setApps(await fetchTrackerApplications());
    } finally {
      setAppsLoading(false);
    }
  }

  useEffect(() => { loadApps(); }, []);

  function openApp(id: number) {
    setSelectedAppId(id);
    setTab("detail");
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">← Dashboard</button>
          <h1 className="text-lg font-bold text-white">Grant Tracker</h1>
        </div>
        {tab !== "detail" && (
          <div className="max-w-5xl mx-auto px-4 flex gap-1 pb-0">
            {([["dashboard", "Dashboard"], ["applications", "My Grants"]] as const).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t as Tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t
                    ? "border-brand-500 text-white"
                    : "border-transparent text-gray-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        {tab === "dashboard" && <DashboardTab onSelectApp={openApp} />}
        {tab === "applications" && (
          <AppsListTab
            apps={apps}
            loading={appsLoading}
            onSelect={openApp}
            onNew={() => setNewAppOpen(true)}
          />
        )}
        {tab === "detail" && selectedAppId != null && (
          <DetailView
            appId={selectedAppId}
            onBack={() => { setTab("applications"); setSelectedAppId(null); }}
            onRefreshList={loadApps}
          />
        )}
      </div>

      {/* New application modal */}
      {newAppOpen && (
        <AppForm
          onSave={async (data) => {
            await createTrackerApplication(data as Parameters<typeof createTrackerApplication>[0]);
            setNewAppOpen(false);
            await loadApps();
            setTab("applications");
          }}
          onClose={() => setNewAppOpen(false)}
        />
      )}
    </div>
  );
}
