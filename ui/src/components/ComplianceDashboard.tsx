import { useEffect, useState, type FormEvent } from "react";
import type {
  ComplianceGrant,
  ComplianceDetail,
  BudgetLine,
  ChecklistItem,
} from "../api";
import {
  fetchComplianceGrants,
  createComplianceGrant,
  fetchComplianceDetail,
  updateComplianceGrant,
  upsertBudgetLine,
  addChecklistItem,
  updateChecklistItem,
  addRemediationNote,
} from "../api";

interface Props {
  onBack: () => void;
}

const STATUS_LABELS: Record<ComplianceGrant["status"], string> = {
  active: "Active",
  flagged: "Flagged",
  under_audit: "Under Audit",
  resolved: "Resolved",
};

const STATUS_COLORS: Record<ComplianceGrant["status"], string> = {
  active: "bg-emerald-900/40 text-emerald-300 border border-emerald-700",
  flagged: "bg-amber-900/40 text-amber-300 border border-amber-700",
  under_audit: "bg-red-900/40 text-red-300 border border-red-700",
  resolved: "bg-gray-800 text-gray-400 border border-gray-600",
};

const EVENT_ICONS: Record<string, string> = {
  budget_change: "💰",
  status_change: "🔄",
  note_added: "📝",
  flag_raised: "🚩",
  checklist_update: "✅",
};

const CHECKLIST_STATUS_COLORS: Record<ChecklistItem["status"], string> = {
  pending: "text-gray-400",
  pass: "text-emerald-400",
  fail: "text-red-400",
  na: "text-gray-500",
};

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function BudgetBar({ allocated, spent }: { allocated: number; spent: number }) {
  const pct = allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0;
  const over = allocated > 0 && spent > allocated;
  return (
    <div className="mt-1 h-2 rounded-full bg-gray-700 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${over ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

type Tab = "budget" | "checklist" | "log";

export default function ComplianceDashboard({ onBack }: Props) {
  const [grants, setGrants] = useState<ComplianceGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ComplianceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("budget");
  const [showNewGrantForm, setShowNewGrantForm] = useState(false);
  const [newGrant, setNewGrant] = useState({ grant_name: "", funder: "", total_awarded: "", period_start: "", period_end: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // budget form
  const [budgetForm, setBudgetForm] = useState({ category: "", allocated: "", spent: "", notes: "" });
  const [budgetSaving, setBudgetSaving] = useState(false);

  // checklist form
  const [newItem, setNewItem] = useState("");
  const [itemSaving, setItemSaving] = useState(false);

  // note form
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    fetchComplianceGrants()
      .then(setGrants)
      .catch(() => setError("Could not load compliance grants"))
      .finally(() => setLoading(false));
  }, []);

  async function loadDetail(id: number) {
    setDetailLoading(true);
    try {
      const d = await fetchComplianceDetail(id);
      setSelected(d);
      setTab("budget");
    } catch {
      setError("Could not load grant detail");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshDetail() {
    if (!selected) return;
    const d = await fetchComplianceDetail(selected.grant.id);
    setSelected(d);
    const updated = await fetchComplianceGrants();
    setGrants(updated);
  }

  async function handleCreateGrant(e: FormEvent) {
    e.preventDefault();
    if (!newGrant.grant_name.trim()) return;
    setSaving(true);
    try {
      const result = await createComplianceGrant({
        grant_name: newGrant.grant_name.trim(),
        funder: newGrant.funder || undefined,
        total_awarded: newGrant.total_awarded ? parseFloat(newGrant.total_awarded) : undefined,
        period_start: newGrant.period_start || undefined,
        period_end: newGrant.period_end || undefined,
      });
      const updated = await fetchComplianceGrants();
      setGrants(updated);
      setShowNewGrantForm(false);
      setNewGrant({ grant_name: "", funder: "", total_awarded: "", period_start: "", period_end: "" });
      await loadDetail(result.id);
    } catch {
      setError("Could not create grant");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: ComplianceGrant["status"]) {
    if (!selected) return;
    await updateComplianceGrant(selected.grant.id, { status });
    await refreshDetail();
  }

  async function handleBudgetSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !budgetForm.category.trim()) return;
    setBudgetSaving(true);
    try {
      await upsertBudgetLine(selected.grant.id, {
        category: budgetForm.category.trim(),
        allocated: budgetForm.allocated ? parseFloat(budgetForm.allocated) : 0,
        spent: budgetForm.spent ? parseFloat(budgetForm.spent) : 0,
        notes: budgetForm.notes || undefined,
      });
      setBudgetForm({ category: "", allocated: "", spent: "", notes: "" });
      await refreshDetail();
    } catch {
      setError("Could not save budget line");
    } finally {
      setBudgetSaving(false);
    }
  }

  function editBudgetLine(line: BudgetLine) {
    setBudgetForm({
      category: line.category,
      allocated: String(line.allocated),
      spent: String(line.spent),
      notes: line.notes ?? "",
    });
  }

  async function handleChecklistAdd(e: FormEvent) {
    e.preventDefault();
    if (!selected || !newItem.trim()) return;
    setItemSaving(true);
    try {
      await addChecklistItem(selected.grant.id, newItem.trim());
      setNewItem("");
      await refreshDetail();
    } catch {
      setError("Could not add checklist item");
    } finally {
      setItemSaving(false);
    }
  }

  async function handleChecklistStatus(itemId: number, status: ChecklistItem["status"]) {
    await updateChecklistItem(itemId, status);
    await refreshDetail();
  }

  async function handleNoteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !note.trim()) return;
    setNoteSaving(true);
    try {
      await addRemediationNote(selected.grant.id, note.trim());
      setNote("");
      await refreshDetail();
    } catch {
      setError("Could not add note");
    } finally {
      setNoteSaving(false);
    }
  }

  const totalAllocated = selected?.budgetLines.reduce((s: number, l: BudgetLine) => s + l.allocated, 0) ?? 0;
  const totalSpent = selected?.budgetLines.reduce((s: number, l: BudgetLine) => s + l.spent, 0) ?? 0;
  const checklistPass = selected?.checklist.filter((i: ChecklistItem) => i.status === "pass").length ?? 0;
  const checklistFail = selected?.checklist.filter((i: ChecklistItem) => i.status === "fail").length ?? 0;
  const checklistTotal = selected?.checklist.length ?? 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
        >
          ← Back
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-white">Compliance & Audit Trail</h1>
          <p className="text-xs text-gray-500">Track budget compliance and audit readiness per grant</p>
        </div>
        <button
          onClick={() => setShowNewGrantForm(true)}
          className="bg-brand-600 hover:bg-brand-500 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
        >
          + Track Grant
        </button>
      </header>

      {error && (
        <div className="mx-4 mt-3 bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-2 rounded-lg flex justify-between">
          {error}
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-200">✕</button>
        </div>
      )}

      {/* New Grant Modal */}
      {showNewGrantForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-base font-semibold mb-4">Add Grant to Compliance Tracking</h2>
            <form onSubmit={handleCreateGrant} className="flex flex-col gap-3">
              <input
                required
                placeholder="Grant name *"
                value={newGrant.grant_name}
                onChange={(e) => setNewGrant((p) => ({ ...p, grant_name: e.target.value }))}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
              <input
                placeholder="Funder"
                value={newGrant.funder}
                onChange={(e) => setNewGrant((p) => ({ ...p, funder: e.target.value }))}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
              <input
                placeholder="Total awarded ($)"
                type="number"
                value={newGrant.total_awarded}
                onChange={(e) => setNewGrant((p) => ({ ...p, total_awarded: e.target.value }))}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  placeholder="Period start"
                  value={newGrant.period_start}
                  onChange={(e) => setNewGrant((p) => ({ ...p, period_start: e.target.value }))}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                />
                <input
                  type="date"
                  placeholder="Period end"
                  value={newGrant.period_end}
                  onChange={(e) => setNewGrant((p) => ({ ...p, period_end: e.target.value }))}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                />
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setShowNewGrantForm(false)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors"
                >
                  {saving ? "Saving…" : "Add Grant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex h-[calc(100vh-57px)]">
        {/* Grant List */}
        <aside className="w-72 border-r border-gray-800 overflow-y-auto flex-shrink-0">
          {loading ? (
            <div className="p-4 text-gray-500 text-sm">Loading…</div>
          ) : grants.length === 0 ? (
            <div className="p-6 text-center text-gray-500 text-sm">
              No grants tracked yet.<br />
              <button onClick={() => setShowNewGrantForm(true)} className="mt-2 text-brand-400 hover:text-brand-300 underline text-xs">
                Add the first one
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {grants.map((g) => (
                <li key={g.id}>
                  <button
                    onClick={() => loadDetail(g.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-800/60 transition-colors ${selected?.grant.id === g.id ? "bg-gray-800" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-white leading-tight line-clamp-2">{g.grant_name}</span>
                      <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-md ${STATUS_COLORS[g.status]}`}>
                        {STATUS_LABELS[g.status]}
                      </span>
                    </div>
                    {g.funder && <p className="text-xs text-gray-500 mt-0.5 truncate">{g.funder}</p>}
                    <div className="flex gap-3 mt-1.5 text-xs text-gray-500">
                      {g.budget_line_count != null && <span>{g.budget_line_count} budget line{g.budget_line_count !== 1 ? "s" : ""}</span>}
                      {(g.checklist_failures ?? 0) > 0 && (
                        <span className="text-red-400">⚠ {g.checklist_failures} failure{g.checklist_failures !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Detail Panel */}
        <main className="flex-1 overflow-y-auto">
          {detailLoading ? (
            <div className="flex items-center justify-center h-40 text-gray-500 text-sm">Loading…</div>
          ) : !selected ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm gap-2">
              <span className="text-3xl">📋</span>
              <p>Select a grant to view compliance detail</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6">
              {/* Grant header */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">{selected.grant.grant_name}</h2>
                  {selected.grant.funder && <p className="text-sm text-gray-400 mt-0.5">{selected.grant.funder}</p>}
                  {(selected.grant.period_start || selected.grant.period_end) && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {selected.grant.period_start ?? "?"} → {selected.grant.period_end ?? "?"}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {selected.grant.total_awarded != null && (
                    <span className="text-sm font-mono text-emerald-400">{fmt(selected.grant.total_awarded)} awarded</span>
                  )}
                  <select
                    value={selected.grant.status}
                    onChange={(e) => handleStatusChange(e.target.value as ComplianceGrant["status"])}
                    className={`text-xs px-2 py-1 rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-500 ${STATUS_COLORS[selected.grant.status]} bg-transparent`}
                  >
                    {(Object.keys(STATUS_LABELS) as ComplianceGrant["status"][]).map((s) => (
                      <option key={s} value={s} className="bg-gray-900 text-white">{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-1">Allocated</p>
                  <p className="text-lg font-mono text-white">{fmt(totalAllocated)}</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-1">Spent</p>
                  <p className={`text-lg font-mono ${totalSpent > totalAllocated ? "text-red-400" : "text-white"}`}>{fmt(totalSpent)}</p>
                  {totalAllocated > 0 && (
                    <p className="text-xs text-gray-500 mt-0.5">{Math.round((totalSpent / totalAllocated) * 100)}% of budget</p>
                  )}
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-1">Checklist</p>
                  <p className="text-lg font-mono text-white">
                    {checklistTotal === 0 ? "—" : `${checklistPass}/${checklistTotal}`}
                  </p>
                  {checklistFail > 0 && <p className="text-xs text-red-400 mt-0.5">{checklistFail} failing</p>}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-800 mb-5">
                {(["budget", "checklist", "log"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                      tab === t ? "border-brand-500 text-brand-400" : "border-transparent text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {t === "log" ? "Audit Log" : t === "checklist" ? "Checklist" : "Budget"}
                  </button>
                ))}
              </div>

              {/* Budget tab */}
              {tab === "budget" && (
                <div className="flex flex-col gap-4">
                  {selected.budgetLines.length === 0 ? (
                    <p className="text-sm text-gray-500">No budget lines yet. Add categories below.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {selected.budgetLines.map((line) => {
                        const over = line.spent > line.allocated && line.allocated > 0;
                        return (
                          <div key={line.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-white capitalize">{line.category}</span>
                              <button
                                onClick={() => editBudgetLine(line)}
                                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                              >
                                Edit
                              </button>
                            </div>
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                              <span>Spent: <span className={over ? "text-red-400 font-medium" : "text-white"}>{fmt(line.spent)}</span></span>
                              <span>Allocated: {fmt(line.allocated)}</span>
                            </div>
                            <BudgetBar allocated={line.allocated} spent={line.spent} />
                            {over && (
                              <p className="text-xs text-red-400 mt-1">⚠ Over budget by {fmt(line.spent - line.allocated)}</p>
                            )}
                            {line.notes && <p className="text-xs text-gray-500 mt-1.5 italic">{line.notes}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <form onSubmit={handleBudgetSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
                    <p className="text-xs text-gray-400 font-medium">{budgetForm.category ? `Editing "${budgetForm.category}"` : "Add / update budget line"}</p>
                    <input
                      required
                      placeholder="Category (e.g. Programming, Admin)"
                      value={budgetForm.category}
                      onChange={(e) => setBudgetForm((p) => ({ ...p, category: e.target.value }))}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                    />
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="Allocated ($)"
                        value={budgetForm.allocated}
                        onChange={(e) => setBudgetForm((p) => ({ ...p, allocated: e.target.value }))}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                      />
                      <input
                        type="number"
                        placeholder="Spent ($)"
                        value={budgetForm.spent}
                        onChange={(e) => setBudgetForm((p) => ({ ...p, spent: e.target.value }))}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                      />
                    </div>
                    <input
                      placeholder="Notes (optional)"
                      value={budgetForm.notes}
                      onChange={(e) => setBudgetForm((p) => ({ ...p, notes: e.target.value }))}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                    />
                    <div className="flex gap-2">
                      {budgetForm.category && (
                        <button
                          type="button"
                          onClick={() => setBudgetForm({ category: "", allocated: "", spent: "", notes: "" })}
                          className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-2 rounded-lg transition-colors"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={budgetSaving}
                        className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors"
                      >
                        {budgetSaving ? "Saving…" : "Save Line"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Checklist tab */}
              {tab === "checklist" && (
                <div className="flex flex-col gap-4">
                  {selected.checklist.length === 0 ? (
                    <p className="text-sm text-gray-500">No checklist items yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {selected.checklist.map((item) => (
                        <li key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-start justify-between gap-3">
                          <span className={`text-sm mt-0.5 ${item.status === "fail" ? "text-red-300" : item.status === "pass" ? "text-emerald-300" : "text-gray-300"}`}>
                            {item.item}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {(["pass", "fail", "pending", "na"] as ChecklistItem["status"][]).map((s) => (
                              <button
                                key={s}
                                onClick={() => handleChecklistStatus(item.id, s)}
                                className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${
                                  item.status === s
                                    ? `${CHECKLIST_STATUS_COLORS[s]} border-current bg-gray-800`
                                    : "text-gray-600 border-gray-700 hover:text-gray-400"
                                }`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <form onSubmit={handleChecklistAdd} className="flex gap-2">
                    <input
                      placeholder="Add funder requirement…"
                      value={newItem}
                      onChange={(e) => setNewItem(e.target.value)}
                      className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                    />
                    <button
                      type="submit"
                      disabled={itemSaving || !newItem.trim()}
                      className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm px-4 py-2 rounded-lg transition-colors"
                    >
                      {itemSaving ? "…" : "Add"}
                    </button>
                  </form>
                </div>
              )}

              {/* Audit log tab */}
              {tab === "log" && (
                <div className="flex flex-col gap-4">
                  <form onSubmit={handleNoteSubmit} className="flex gap-2">
                    <input
                      placeholder="Add remediation note…"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                    />
                    <button
                      type="submit"
                      disabled={noteSaving || !note.trim()}
                      className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm px-4 py-2 rounded-lg transition-colors"
                    >
                      {noteSaving ? "…" : "Log Note"}
                    </button>
                  </form>

                  {selected.auditLog.length === 0 ? (
                    <p className="text-sm text-gray-500">No events recorded yet.</p>
                  ) : (
                    <ol className="relative border-l border-gray-800 ml-3 flex flex-col gap-0">
                      {selected.auditLog.map((ev) => (
                        <li key={ev.id} className="ml-5 pb-5">
                          <span className="absolute -left-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 border border-gray-700 text-xs">
                            {EVENT_ICONS[ev.event_type] ?? "•"}
                          </span>
                          <p className="text-sm text-gray-200">{ev.description}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {ev.actor} · {new Date(ev.created_at).toLocaleString()}
                          </p>
                          {ev.before_value && ev.after_value && (
                            <p className="text-xs text-gray-600 mt-0.5 font-mono">
                              {ev.before_value} → {ev.after_value}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
