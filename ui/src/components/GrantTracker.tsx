import { useEffect, useState } from "react";
import {
  fetchTrackerApplications,
  fetchTrackerDetail,
  fetchTrackerDashboard,
  createTrackerApplication,
  updateTrackerApplication,
  addOutput,
  updateOutput,
  addOutcome,
  updateOutcome,
  logActuals,
  type GrantApplication,
  type TrackerDetail,
  type DashboardPeriod,
  type Periodicity,
  type LifecycleStatus,
  type ReportingPeriod,
  type GrantOutput,
  type GrantOutcome,
  type OutputStatus,
  type OutcomeStatus,
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

const METRIC_STATUS_COLORS: Record<string, string> = {
  met: "text-green-400",
  partial: "text-yellow-400",
  missed: "text-red-400",
  reported: "text-green-400",
  "not yet reported": "text-gray-500",
};

const METRIC_STATUS_ICONS: Record<string, string> = {
  met: "✓",
  partial: "~",
  missed: "✗",
  reported: "✓",
  "not yet reported": "·",
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

function outputStatusPreview(actual: string, target: number): OutputStatus | null {
  if (actual === "") return null;
  const n = Number(actual);
  if (n === 0) return "missed";
  return n / target >= 1.0 ? "met" : "partial";
}

function outcomeStatusPreview(actual: string, target: number | null, isNarrative: boolean, narrativeActual: string): OutcomeStatus | null {
  if (isNarrative) return narrativeActual.trim() ? "reported" : "not yet reported";
  if (actual === "" || target == null) return null;
  const n = Number(actual);
  if (n === 0) return "missed";
  return n / target >= 1.0 ? "met" : "partial";
}

// ── New/Edit Application Modal ─────────────────────────────────────────────────
interface AppFormProps {
  initial?: Partial<GrantApplication>;
  onSave: (data: Partial<GrantApplication>) => Promise<void>;
  onClose: () => void;
}

function AppForm({ initial, onSave, onClose }: AppFormProps) {
  const isEdit = Boolean(initial?.id);
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
    logic_inputs: initial?.logic_inputs ?? "",
    logic_activities: initial?.logic_activities ?? "",
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
        logic_inputs: form.logic_inputs.trim() || undefined,
        logic_activities: form.logic_activities.trim() || undefined,
      });
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Save failed");
      setSaving(false);
    }
  }

  const inputCls = "w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand-500";

  // ── New grant: just a name ────────────────────────────────────────────────
  if (!isEdit) {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70">
        <form
          onSubmit={handleSubmit}
          className="bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-xl w-full sm:max-w-md p-6 shadow-2xl"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-white">New grant</h2>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center text-xl">✕</button>
          </div>
          <label className="block text-xs text-gray-400 mb-1.5">Grant name</label>
          <input
            autoFocus
            className={inputCls}
            placeholder="e.g. Community Workforce Initiative"
            value={form.grant_name}
            onChange={(e) => update("grant_name", e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-2">Add funder, dates, and logic model from the grant detail page after creating.</p>
          {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
          <div className="flex gap-3 mt-5">
            <button type="button" onClick={onClose} className="px-4 py-2.5 text-sm text-gray-400 border border-gray-700 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg font-medium disabled:opacity-50">
              {saving ? "Creating…" : "Create grant"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ── Edit: scrollable bottom sheet with sections ───────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-xl w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[92dvh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <h2 className="text-base font-semibold text-white">Edit grant</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center text-xl">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-6">
          <section className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Basic</p>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Grant name *</label>
              <input className={inputCls} value={form.grant_name} onChange={(e) => update("grant_name", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Funder</label>
                <input className={inputCls} value={form.funder} onChange={(e) => update("funder", e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Total awarded ($)</label>
                <input type="number" min="0" className={inputCls} value={form.total_awarded} onChange={(e) => update("total_awarded", e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Status</label>
                <select className={inputCls} value={form.lifecycle_status} onChange={(e) => update("lifecycle_status", e.target.value)}>
                  {(["applied", "offered", "funded", "closed"] as LifecycleStatus[]).map((s) => (
                    <option key={s} value={s}>{LIFECYCLE_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Reporting schedule</label>
                <select className={inputCls} value={form.periodicity} onChange={(e) => update("periodicity", e.target.value)}>
                  {(["one-time", "monthly", "quarterly", "annual", "custom"] as Periodicity[]).map((p) => (
                    <option key={p} value={p}>{PERIODICITY_LABELS[p]}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Dates</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Application date</label>
                <input type="date" className={inputCls} value={form.application_date} onChange={(e) => update("application_date", e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Offer date</label>
                <input type="date" className={inputCls} value={form.offer_date} onChange={(e) => update("offer_date", e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Funded date</label>
                <input type="date" className={inputCls} value={form.funded_date} onChange={(e) => update("funded_date", e.target.value)} />
              </div>
              {form.periodicity === "custom" && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Interval (days)</label>
                  <input type="number" min="1" className={inputCls} value={form.custom_interval_days} onChange={(e) => update("custom_interval_days", e.target.value)} />
                </div>
              )}
              {form.periodicity !== "one-time" && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Periods to generate</label>
                  <input type="number" min="1" max="24" className={inputCls} value={form.period_horizon} onChange={(e) => update("period_horizon", e.target.value)} />
                </div>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Logic model</p>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Inputs</label>
              <textarea rows={2} placeholder="Funding amounts and resources committed" className={`${inputCls} resize-none`} value={form.logic_inputs} onChange={(e) => update("logic_inputs", e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Activities</label>
              <textarea rows={2} placeholder="What will be done with the funding" className={`${inputCls} resize-none`} value={form.logic_activities} onChange={(e) => update("logic_activities", e.target.value)} />
            </div>
          </section>

          <section>
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
          </section>
        </div>

        {err && <p className="text-red-400 text-xs px-5 py-1">{err}</p>}

        <div className="flex gap-3 px-5 py-4 border-t border-gray-800 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2.5 text-sm text-gray-400 border border-gray-700 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg font-medium disabled:opacity-50">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Add Output Modal ───────────────────────────────────────────────────────────
interface AddOutputProps {
  appId: number;
  existing?: GrantOutput;
  onSave: () => void;
  onClose: () => void;
}

function AddOutputModal({ appId, existing, onSave, onClose }: AddOutputProps) {
  const [description, setDescription] = useState(existing?.description ?? "");
  const [targetValue, setTargetValue] = useState(existing?.target_value != null ? String(existing.target_value) : "");
  const [unit, setUnit] = useState(existing?.unit ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) { setErr("Description is required."); return; }
    if (!targetValue) { setErr("Target value is required."); return; }
    setSaving(true);
    setErr("");
    try {
      if (existing) {
        await updateOutput(existing.id, { description: description.trim(), target_value: Number(targetValue), unit: unit.trim() });
      } else {
        await addOutput(appId, { description: description.trim(), target_value: Number(targetValue), unit: unit.trim() });
      }
      onSave();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form onSubmit={handleSubmit} className="relative bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">✕</button>
        <h2 className="text-lg font-semibold text-white mb-4">{existing ? "Edit Output" : "Add Output"}</h2>
        <p className="text-xs text-gray-400 mb-4">Outputs are immediate, countable deliverables (e.g. "12 workshops held").</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description *</label>
            <input className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500" placeholder="e.g. Workshops held" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Target value *</label>
              <input type="number" min="0" className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
            </div>
            <div className="w-28">
              <label className="block text-xs text-gray-400 mb-1">Unit</label>
              <input className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500" placeholder="workshops" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>
        </div>

        {err && <p className="text-red-400 text-xs mt-3">{err}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
          <button type="submit" disabled={saving} className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

// ── Add Outcome Modal ──────────────────────────────────────────────────────────
interface AddOutcomeProps {
  appId: number;
  existing?: GrantOutcome;
  onSave: () => void;
  onClose: () => void;
}

function AddOutcomeModal({ appId, existing, onSave, onClose }: AddOutcomeProps) {
  const [description, setDescription] = useState(existing?.description ?? "");
  const [isNarrative, setIsNarrative] = useState(existing ? Boolean(existing.is_narrative) : false);
  const [targetValue, setTargetValue] = useState(existing?.target_value != null ? String(existing.target_value) : "");
  const [targetNarrative, setTargetNarrative] = useState(existing?.target_narrative ?? "");
  const [unit, setUnit] = useState(existing?.unit ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) { setErr("Description is required."); return; }
    if (!isNarrative && !targetValue) { setErr("Target value is required for numeric outcomes."); return; }
    setSaving(true);
    setErr("");
    try {
      if (existing) {
        await updateOutcome(existing.id, {
          description: description.trim(),
          target_value: !isNarrative && targetValue ? Number(targetValue) : undefined,
          target_narrative: isNarrative ? targetNarrative.trim() || undefined : undefined,
          unit: unit.trim(),
        });
      } else {
        await addOutcome(appId, {
          description: description.trim(),
          is_narrative: isNarrative,
          target_value: !isNarrative && targetValue ? Number(targetValue) : undefined,
          target_narrative: isNarrative ? targetNarrative.trim() || undefined : undefined,
          unit: unit.trim(),
        });
      }
      onSave();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form onSubmit={handleSubmit} className="relative bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">✕</button>
        <h2 className="text-lg font-semibold text-white mb-4">{existing ? "Edit Outcome" : "Add Outcome"}</h2>
        <p className="text-xs text-gray-400 mb-4">Outcomes describe change in the target population (e.g. "60% of participants report increased income").</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description *</label>
            <input className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500" placeholder="e.g. Participants reporting increased income" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {!existing && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsNarrative(false)}
                className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${!isNarrative ? "border-brand-500 bg-brand-900/30 text-brand-300" : "border-gray-600 text-gray-400 hover:text-white"}`}
              >
                Numeric target
              </button>
              <button
                type="button"
                onClick={() => setIsNarrative(true)}
                className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${isNarrative ? "border-brand-500 bg-brand-900/30 text-brand-300" : "border-gray-600 text-gray-400 hover:text-white"}`}
              >
                Narrative only
              </button>
            </div>
          )}

          {!isNarrative ? (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">Target value *</label>
                <input type="number" min="0" className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
              </div>
              <div className="w-28">
                <label className="block text-xs text-gray-400 mb-1">Unit</label>
                <input className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500" placeholder="%" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Target description (optional)</label>
              <textarea rows={2} className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500 resize-none" placeholder="e.g. Participants demonstrate knowledge of financial tools" value={targetNarrative} onChange={(e) => setTargetNarrative(e.target.value)} />
            </div>
          )}
        </div>

        {err && <p className="text-red-400 text-xs mt-3">{err}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
          <button type="submit" disabled={saving} className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

// ── Log Actuals Modal ──────────────────────────────────────────────────────────
interface LogActualsProps {
  period: ReportingPeriod;
  outputs: GrantOutput[];
  outcomes: GrantOutcome[];
  onSave: () => void;
  onClose: () => void;
}

function LogActualsModal({ period, outputs, outcomes, onSave, onClose }: LogActualsProps) {
  const [outputVals, setOutputVals] = useState<Record<number, string>>(() =>
    Object.fromEntries(outputs.map((o) => [o.id, o.actual_value != null ? String(o.actual_value) : ""]))
  );
  const [outcomeNumericVals, setOutcomeNumericVals] = useState<Record<number, string>>(() =>
    Object.fromEntries(outcomes.filter((o) => !o.is_narrative).map((o) => [o.id, o.actual_value != null ? String(o.actual_value) : ""]))
  );
  const [outcomeNarrVals, setOutcomeNarrVals] = useState<Record<number, string>>(() =>
    Object.fromEntries(outcomes.filter((o) => o.is_narrative).map((o) => [o.id, o.actual_narrative ?? ""]))
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const hasAny = outputs.length > 0 || outcomes.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      const outputActuals = outputs
        .filter((o) => outputVals[o.id] !== "")
        .map((o) => ({ output_id: o.id, actual_value: Number(outputVals[o.id]) }));
      const outcomeActuals = outcomes.map((oc) => {
        if (oc.is_narrative) {
          return { outcome_id: oc.id, actual_narrative: outcomeNarrVals[oc.id] ?? "" };
        } else {
          const v = outcomeNumericVals[oc.id];
          return v !== "" ? { outcome_id: oc.id, actual_value: Number(v) } : null;
        }
      }).filter(Boolean) as { outcome_id: number; actual_value?: number; actual_narrative?: string }[];

      await logActuals(period.id, { output_actuals: outputActuals, outcome_actuals: outcomeActuals });
      onSave();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <form onSubmit={handleSubmit} className="relative bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg p-6 shadow-2xl my-4">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">✕</button>
        <h2 className="text-lg font-semibold text-white mb-1">Log Actuals</h2>
        <p className="text-xs text-gray-400 mb-5">Reporting period {period.period_number} — due {fmt(period.due_date)}</p>

        {!hasAny ? (
          <p className="text-gray-400 text-sm">No outputs or outcomes defined yet. Add them to the Logic Model first.</p>
        ) : (
          <div className="space-y-5">
            {/* Outputs section */}
            {outputs.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">Outputs</h3>
                <div className="space-y-3">
                  {outputs.map((o) => {
                    const val = outputVals[o.id] ?? "";
                    const status = outputStatusPreview(val, o.target_value);
                    const pct = val !== "" && o.target_value ? ((Number(val) / o.target_value) * 100).toFixed(0) : null;
                    return (
                      <div key={o.id} className="bg-gray-800 rounded-lg p-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <p className="text-sm text-white">{o.description}</p>
                            <p className="text-xs text-gray-500">Target: {o.target_value} {o.unit} · Met = 100%</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-brand-500"
                              value={val}
                              placeholder="Actual"
                              onChange={(e) => setOutputVals((v) => ({ ...v, [o.id]: e.target.value }))}
                            />
                            {status && (
                              <span className={`text-sm font-medium ${METRIC_STATUS_COLORS[status]}`}>
                                {METRIC_STATUS_ICONS[status]}{pct != null ? ` ${pct}%` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Outcomes section */}
            {outcomes.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">Outcomes</h3>
                <div className="space-y-3">
                  {outcomes.map((oc) => {
                    if (oc.is_narrative) {
                      const narr = outcomeNarrVals[oc.id] ?? "";
                      const status = outcomeStatusPreview("", null, true, narr);
                      return (
                        <div key={oc.id} className="bg-gray-800 rounded-lg p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1">
                              <p className="text-sm text-white">{oc.description}</p>
                              {oc.target_narrative && <p className="text-xs text-gray-500 mt-0.5">Target: {oc.target_narrative}</p>}
                            </div>
                            {status && (
                              <span className={`text-xs font-medium ${METRIC_STATUS_COLORS[status]}`}>
                                {status}
                              </span>
                            )}
                          </div>
                          <textarea
                            rows={2}
                            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-brand-500 resize-none"
                            placeholder="Describe what was observed or achieved…"
                            value={narr}
                            onChange={(e) => setOutcomeNarrVals((v) => ({ ...v, [oc.id]: e.target.value }))}
                          />
                        </div>
                      );
                    } else {
                      const val = outcomeNumericVals[oc.id] ?? "";
                      const status = outcomeStatusPreview(val, oc.target_value, false, "");
                      const pct = val !== "" && oc.target_value ? ((Number(val) / oc.target_value) * 100).toFixed(0) : null;
                      return (
                        <div key={oc.id} className="bg-gray-800 rounded-lg p-3">
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <p className="text-sm text-white">{oc.description}</p>
                              <p className="text-xs text-gray-500">Target: {oc.target_value} {oc.unit} · Met = 100%</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-brand-500"
                                value={val}
                                placeholder="Actual"
                                onChange={(e) => setOutcomeNumericVals((v) => ({ ...v, [oc.id]: e.target.value }))}
                              />
                              {status && (
                                <span className={`text-sm font-medium ${METRIC_STATUS_COLORS[status]}`}>
                                  {METRIC_STATUS_ICONS[status]}{pct != null ? ` ${pct}%` : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {err && <p className="text-red-400 text-xs mt-3">{err}</p>}

        <div className="flex justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-white">Cancel</button>
          <button type="submit" disabled={saving || !hasAny} className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg disabled:opacity-50">
            {saving ? "Saving…" : "Submit Report"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Detail View ────────────────────────────────────────────────────────────────
interface DetailViewProps {
  appId: number;
  onBack: () => void;
  onRefreshList: () => void;
}

function DetailView({ appId, onBack, onRefreshList }: DetailViewProps) {
  const [detail, setDetail] = useState<TrackerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [addOutputOpen, setAddOutputOpen] = useState(false);
  const [editingOutput, setEditingOutput] = useState<GrantOutput | undefined>();
  const [addOutcomeOpen, setAddOutcomeOpen] = useState(false);
  const [editingOutcome, setEditingOutcome] = useState<GrantOutcome | undefined>();
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

  const { application: app, outputs, outcomes, reportingPeriods } = detail;
  const today = new Date().toISOString().slice(0, 10);

  const STEPS: LifecycleStatus[] = ["applied", "offered", "funded", "closed"];
  const currentStep = STEPS.indexOf(app.lifecycle_status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">← Back</button>
        <h2 className="text-xl font-bold text-white flex-1 truncate">{app.grant_name}</h2>
        <button onClick={() => setEditOpen(true)} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg">Edit</button>
      </div>

      {/* Timeline strip */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-4">Lifecycle Timeline</h3>
        <div className="flex items-center gap-0">
          {STEPS.map((step, i) => {
            const done = i <= currentStep;
            const dateMap: Record<LifecycleStatus, string | null | undefined> = {
              applied: app.application_date,
              offered: app.offer_date,
              funded: app.funded_date,
              closed: null,
            };
            return (
              <div key={step} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center min-w-0">
                  <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 flex items-center justify-center text-xs sm:text-sm font-bold transition-colors ${done ? "border-brand-500 bg-brand-600 text-white" : "border-gray-600 bg-gray-800 text-gray-500"}`}>
                    {done ? "✓" : i + 1}
                  </div>
                  <span className={`text-xs mt-1 font-medium truncate max-w-full px-0.5 ${done ? "text-white" : "text-gray-500"}`}>{LIFECYCLE_LABELS[step]}</span>
                  <span className="text-xs text-gray-500 hidden sm:block">{fmt(dateMap[step])}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-1 ${i < currentStep ? "bg-brand-600" : "bg-gray-700"}`} />}
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
            <div>
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
              const eff = p.effective_status ?? (p.status === "upcoming" && p.due_date < today ? "overdue" : p.status);
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
                    <button onClick={() => setLogPeriod(p)} className="text-xs px-3 py-1 bg-brand-700 hover:bg-brand-600 text-white rounded">
                      Log actuals
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Logic Model */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-5">
        <h3 className="text-xs text-gray-400 uppercase tracking-wider">Logic Model</h3>

        {/* Inputs */}
        <div>
          <p className="text-xs font-semibold text-gray-300 mb-1">Inputs</p>
          {app.logic_inputs ? (
            <p className="text-sm text-gray-200 whitespace-pre-wrap">{app.logic_inputs}</p>
          ) : (
            <p className="text-sm text-gray-500 italic">Not set — edit the grant to describe funding amounts and resources committed.</p>
          )}
        </div>

        {/* Activities */}
        <div>
          <p className="text-xs font-semibold text-gray-300 mb-1">Activities</p>
          {app.logic_activities ? (
            <p className="text-sm text-gray-200 whitespace-pre-wrap">{app.logic_activities}</p>
          ) : (
            <p className="text-sm text-gray-500 italic">Not set — edit the grant to describe what will be done with the funding.</p>
          )}
        </div>

        {/* Outputs */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-semibold text-gray-300">Outputs</span>
              <span className="text-xs text-gray-500 ml-1">— immediate, countable deliverables</span>
            </div>
            <button
              onClick={() => { setEditingOutput(undefined); setAddOutputOpen(true); }}
              className="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
            >
              + Add
            </button>
          </div>
          {outputs.length === 0 ? (
            <p className="text-sm text-gray-500">No outputs yet.</p>
          ) : (
            <div className="space-y-1.5">
              {outputs.map((o) => {
                const pct = o.actual_value != null && o.target_value ? ((o.actual_value / o.target_value) * 100).toFixed(0) : null;
                const st = o.computed_status;
                return (
                  <div key={o.id} className="flex items-center gap-3 text-xs text-gray-300 bg-gray-800/50 rounded px-3 py-2">
                    <span className={`w-4 text-center font-bold ${st ? METRIC_STATUS_COLORS[st] : "text-gray-500"}`}>
                      {st ? METRIC_STATUS_ICONS[st] : "·"}
                    </span>
                    <span className="flex-1">{o.description}</span>
                    <span className="text-gray-500">
                      {o.actual_value != null ? o.actual_value : "—"} / {o.target_value} {o.unit}
                      {pct != null ? ` (${pct}%)` : ""}
                    </span>
                    <button onClick={() => { setEditingOutput(o); setAddOutputOpen(true); }} className="text-gray-500 hover:text-white ml-1">✎</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Outcomes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-semibold text-gray-300">Outcomes</span>
              <span className="text-xs text-gray-500 ml-1">— change in target population</span>
            </div>
            <button
              onClick={() => { setEditingOutcome(undefined); setAddOutcomeOpen(true); }}
              className="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
            >
              + Add
            </button>
          </div>
          {outcomes.length === 0 ? (
            <p className="text-sm text-gray-500">No outcomes yet.</p>
          ) : (
            <div className="space-y-1.5">
              {outcomes.map((oc) => {
                const st = oc.computed_status ?? (oc.is_narrative ? "not yet reported" : undefined);
                const isNarr = Boolean(oc.is_narrative);
                const pct = !isNarr && oc.actual_value != null && oc.target_value
                  ? ((oc.actual_value / oc.target_value) * 100).toFixed(0)
                  : null;
                return (
                  <div key={oc.id} className="flex items-start gap-3 text-xs text-gray-300 bg-gray-800/50 rounded px-3 py-2">
                    <span className={`w-4 text-center font-bold mt-0.5 ${st ? METRIC_STATUS_COLORS[st] : "text-gray-500"}`}>
                      {st ? METRIC_STATUS_ICONS[st] : "·"}
                    </span>
                    <span className="flex-1">{oc.description}</span>
                    {isNarr ? (
                      <span className={`italic ${st ? METRIC_STATUS_COLORS[st] : "text-gray-500"}`}>{st ?? "not yet reported"}</span>
                    ) : (
                      <span className="text-gray-500">
                        {oc.actual_value != null ? oc.actual_value : "—"} / {oc.target_value} {oc.unit}
                        {pct != null ? ` (${pct}%)` : ""}
                      </span>
                    )}
                    <button onClick={() => { setEditingOutcome(oc); setAddOutcomeOpen(true); }} className="text-gray-500 hover:text-white ml-1">✎</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
      {addOutputOpen && (
        <AddOutputModal
          appId={appId}
          existing={editingOutput}
          onSave={async () => { setAddOutputOpen(false); await load(); }}
          onClose={() => setAddOutputOpen(false)}
        />
      )}
      {addOutcomeOpen && (
        <AddOutcomeModal
          appId={appId}
          existing={editingOutcome}
          onSave={async () => { setAddOutcomeOpen(false); await load(); }}
          onClose={() => setAddOutcomeOpen(false)}
        />
      )}
      {logPeriod && (
        <LogActualsModal
          period={logPeriod}
          outputs={outputs}
          outcomes={outcomes}
          onSave={async () => { setLogPeriod(null); await load(); }}
          onClose={() => setLogPeriod(null)}
        />
      )}
    </div>
  );
}

// ── Dashboard Tab ──────────────────────────────────────────────────────────────
function DashboardTab({ onSelectApp }: { onSelectApp: (id: number) => void }) {
  const [periods, setPeriods] = useState<DashboardPeriod[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTrackerDashboard()
      .then(setPeriods)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>;

  const overdue  = periods.filter((p) => p.effective_status === "overdue");
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
                <button onClick={() => onSelectApp(p.grant_application_id)} className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">View</button>
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
              <button onClick={() => onSelectApp(p.grant_application_id)} className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">View</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Applications List Tab ──────────────────────────────────────────────────────
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
        <button onClick={onNew} className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg">
          + New Application
        </button>
      </div>
      {apps.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-4">No grant applications yet.</p>
          <button onClick={onNew} className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg">+ New Application</button>
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
                  <p>{(app.logic_count ?? 0)} logic model item{(app.logic_count ?? 0) !== 1 ? "s" : ""}</p>
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

// ── Main GrantTracker ──────────────────────────────────────────────────────────
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
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-brand-500 text-white" : "border-transparent text-gray-400 hover:text-white"}`}
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
