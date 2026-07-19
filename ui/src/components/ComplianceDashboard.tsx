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

const CHECKLIST_STATUS_LABELS: Record<ChecklistItem["status"], string> = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail",
  na: "N/A",
};

const CHECKLIST_BUTTON_STYLES: Record<ChecklistItem["status"], string> = {
  pending: "border-gray-600 text-gray-400",
  pass: "border-emerald-600 text-emerald-400 bg-emerald-900/30",
  fail: "border-red-600 text-red-400 bg-red-900/30",
  na: "border-gray-600 text-gray-500 bg-gray-800",
};

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function InlineError({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  if (!msg) return null;
  return (
    <div className="flex items-start justify-between gap-2 bg-red-900/30 border border-red-700/60 text-red-300 text-xs px-3 py-2 rounded-lg">
      <span>{msg}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 text-red-400 hover:text-red-200 leading-none">✕</button>
    </div>
  );
}

function BudgetBar({ allocated, spent }: { allocated: number; spent: number }) {
  const pct = allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0;
  const over = allocated > 0 && spent > allocated;
  return (
    <div className="mt-1.5 h-2 rounded-full bg-gray-700 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-300 ${
          over ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

type Tab = "budget" | "checklist" | "log";

const BLANK_GRANT = { grant_name: "", funder: "", total_awarded: "", period_start: "", period_end: "" };
const BLANK_BUDGET = { category: "", allocated: "", spent: "", notes: "" };

export default function ComplianceDashboard({ onBack }: Props) {
  // ── list state ─────────────────────────────────────────────────────────────
  const [grants, setGrants] = useState<ComplianceGrant[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  // ── detail state ───────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<ComplianceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("budget");

  // ── new grant modal ────────────────────────────────────────────────────────
  const [showNewGrantForm, setShowNewGrantForm] = useState(false);
  const [newGrant, setNewGrant] = useState(BLANK_GRANT);
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantError, setGrantError] = useState("");

  // ── budget form ────────────────────────────────────────────────────────────
  const [budgetForm, setBudgetForm] = useState(BLANK_BUDGET);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetError, setBudgetError] = useState("");

  // ── checklist form ─────────────────────────────────────────────────────────
  const [newItem, setNewItem] = useState("");
  const [itemSaving, setItemSaving] = useState(false);
  const [checklistError, setChecklistError] = useState("");

  // ── note form ──────────────────────────────────────────────────────────────
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState("");

  // ── load grant list ────────────────────────────────────────────────────────
  useEffect(() => {
    setListLoading(true);
    fetchComplianceGrants()
      .then(setGrants)
      .catch((err: unknown) => setListError(err instanceof Error ? err.message : "Could not load compliance grants"))
      .finally(() => setListLoading(false));
  }, []);

  async function loadDetail(id: number) {
    setDetailLoading(true);
    try {
      const d = await fetchComplianceDetail(id);
      setSelected(d);
      setTab("budget");
      setBudgetForm(BLANK_BUDGET);
      setBudgetError("");
      setChecklistError("");
      setNoteError("");
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : "Could not load grant detail");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshDetail() {
    if (!selected) return;
    const [detail, list] = await Promise.all([
      fetchComplianceDetail(selected.grant.id),
      fetchComplianceGrants(),
    ]);
    setSelected(detail);
    setGrants(list);
  }

  // ── create grant ───────────────────────────────────────────────────────────
  function openNewGrantModal() {
    setNewGrant(BLANK_GRANT);
    setGrantError("");
    setShowNewGrantForm(true);
  }

  async function handleCreateGrant(e: FormEvent) {
    e.preventDefault();
    if (!newGrant.grant_name.trim()) return;
    setGrantSaving(true);
    setGrantError("");
    try {
      const result = await createComplianceGrant({
        grant_name: newGrant.grant_name.trim(),
        funder: newGrant.funder || undefined,
        total_awarded: newGrant.total_awarded ? parseFloat(newGrant.total_awarded) : undefined,
        period_start: newGrant.period_start || undefined,
        period_end: newGrant.period_end || undefined,
      });
      setShowNewGrantForm(false);
      setNewGrant(BLANK_GRANT);
      // Refresh list then open the new grant's detail
      const updated = await fetchComplianceGrants();
      setGrants(updated);
      await loadDetail(result.id);
    } catch (err: unknown) {
      // Error surfaces INSIDE the modal so the user can see it without the modal closing
      setGrantError(err instanceof Error ? err.message : "Could not create grant");
    } finally {
      setGrantSaving(false);
    }
  }

  // ── status change ──────────────────────────────────────────────────────────
  async function handleStatusChange(status: ComplianceGrant["status"]) {
    if (!selected) return;
    try {
      await updateComplianceGrant(selected.grant.id, { status });
      await refreshDetail();
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : "Could not update status");
    }
  }

  // ── budget ─────────────────────────────────────────────────────────────────
  function editBudgetLine(line: BudgetLine) {
    setBudgetForm({
      category: line.category,
      allocated: String(line.allocated),
      spent: String(line.spent),
      notes: line.notes ?? "",
    });
    setBudgetError("");
  }

  async function handleBudgetSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !budgetForm.category.trim()) return;
    setBudgetSaving(true);
    setBudgetError("");
    try {
      await upsertBudgetLine(selected.grant.id, {
        category: budgetForm.category.trim(),
        allocated: budgetForm.allocated ? parseFloat(budgetForm.allocated) : 0,
        spent: budgetForm.spent ? parseFloat(budgetForm.spent) : 0,
        notes: budgetForm.notes || undefined,
      });
      setBudgetForm(BLANK_BUDGET);
      await refreshDetail();
    } catch (err: unknown) {
      setBudgetError(err instanceof Error ? err.message : "Could not save budget line");
    } finally {
      setBudgetSaving(false);
    }
  }

  // ── checklist ──────────────────────────────────────────────────────────────
  async function handleChecklistAdd(e: FormEvent) {
    e.preventDefault();
    if (!selected || !newItem.trim()) return;
    setItemSaving(true);
    setChecklistError("");
    try {
      await addChecklistItem(selected.grant.id, newItem.trim());
      setNewItem("");
      await refreshDetail();
    } catch (err: unknown) {
      setChecklistError(err instanceof Error ? err.message : "Could not add checklist item");
    } finally {
      setItemSaving(false);
    }
  }

  async function handleChecklistStatus(itemId: number, status: ChecklistItem["status"]) {
    setChecklistError("");
    try {
      await updateChecklistItem(itemId, status);
      await refreshDetail();
    } catch (err: unknown) {
      setChecklistError(err instanceof Error ? err.message : "Could not update item");
    }
  }

  // ── notes ──────────────────────────────────────────────────────────────────
  async function handleNoteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !note.trim()) return;
    setNoteSaving(true);
    setNoteError("");
    try {
      await addRemediationNote(selected.grant.id, note.trim());
      setNote("");
      await refreshDetail();
    } catch (err: unknown) {
      setNoteError(err instanceof Error ? err.message : "Could not add note");
    } finally {
      setNoteSaving(false);
    }
  }

  // ── derived totals ─────────────────────────────────────────────────────────
  const totalAllocated = selected?.budgetLines.reduce((s: number, l: BudgetLine) => s + l.allocated, 0) ?? 0;
  const totalSpent = selected?.budgetLines.reduce((s: number, l: BudgetLine) => s + l.spent, 0) ?? 0;
  const checklistPass = selected?.checklist.filter((i: ChecklistItem) => i.status === "pass").length ?? 0;
  const checklistFail = selected?.checklist.filter((i: ChecklistItem) => i.status === "fail").length ?? 0;
  const checklistTotal = selected?.checklist.length ?? 0;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white text-sm flex items-center gap-1.5 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Grants
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-white leading-tight">Compliance &amp; Audit Trail</h1>
          <p className="text-xs text-gray-500">Track budget compliance and audit readiness per grant</p>
        </div>
        <button
          onClick={openNewGrantModal}
          className="bg-brand-600 hover:bg-brand-500 text-white text-sm px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Track Grant
        </button>
      </header>

      {/* ── Page-level error (load failures, status changes) ────────────────── */}
      {listError && (
        <div className="mx-4 mt-3 bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-2.5 rounded-lg flex items-start justify-between gap-2">
          <span>{listError}</span>
          <button onClick={() => setListError("")} className="shrink-0 text-red-400 hover:text-red-200">✕</button>
        </div>
      )}

      {/* ── New Grant Modal ─────────────────────────────────────────────────── */}
      {showNewGrantForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-grant-title"
        >
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 id="new-grant-title" className="text-base font-semibold mb-1">Track a Grant</h2>
            <p className="text-xs text-gray-500 mb-4">Add a grant to the compliance tracker. Typically used when restricted funds may have been misused.</p>

            {/* Error inside the modal so it's always visible to the user */}
            {grantError && (
              <div className="mb-3">
                <InlineError msg={grantError} onDismiss={() => setGrantError("")} />
              </div>
            )}

            <form onSubmit={handleCreateGrant} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1" htmlFor="cg-name">Grant name <span className="text-red-400">*</span></label>
                <input
                  id="cg-name"
                  required
                  placeholder="e.g. USDA Community Programs FY2025"
                  value={newGrant.grant_name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGrant((p) => ({ ...p, grant_name: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1" htmlFor="cg-funder">Funder</label>
                <input
                  id="cg-funder"
                  placeholder="e.g. USDA Rural Development"
                  value={newGrant.funder}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGrant((p) => ({ ...p, funder: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1" htmlFor="cg-amount">Total awarded ($)</label>
                <input
                  id="cg-amount"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="50000"
                  value={newGrant.total_awarded}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGrant((p) => ({ ...p, total_awarded: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1" htmlFor="cg-start">Period start</label>
                  <input
                    id="cg-start"
                    type="date"
                    value={newGrant.period_start}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGrant((p) => ({ ...p, period_start: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1" htmlFor="cg-end">Period end</label>
                  <input
                    id="cg-end"
                    type="date"
                    value={newGrant.period_end}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewGrant((p) => ({ ...p, period_end: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
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
                  disabled={grantSaving || !newGrant.grant_name.trim()}
                  className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm py-2 rounded-lg transition-colors"
                >
                  {grantSaving ? "Saving…" : "Add Grant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Main layout ─────────────────────────────────────────────────────── */}
      <div className="flex h-[calc(100vh-57px)]">

        {/* ── Grant list sidebar ─────────────────────────────────────────────── */}
        <aside className="w-72 border-r border-gray-800 overflow-y-auto flex-shrink-0">
          {listLoading ? (
            <div className="p-6 flex justify-center">
              <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : grants.length === 0 && !listError ? (
            <div className="p-6 text-center text-gray-500 text-sm">
              <p className="text-2xl mb-2">📋</p>
              <p className="font-medium text-gray-400 mb-1">No grants tracked yet</p>
              <p className="text-xs mb-3">Add a grant to start tracking compliance and budget adherence.</p>
              <button
                onClick={openNewGrantModal}
                className="text-brand-400 hover:text-brand-300 text-xs underline"
              >
                Track your first grant
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-800/60">
              {grants.map((g) => (
                <li key={g.id}>
                  <button
                    onClick={() => loadDetail(g.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors ${
                      selected?.grant.id === g.id
                        ? "bg-gray-800"
                        : "hover:bg-gray-800/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-sm font-medium text-white leading-snug line-clamp-2">{g.grant_name}</span>
                      <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded-md font-medium ${STATUS_COLORS[g.status]}`}>
                        {STATUS_LABELS[g.status]}
                      </span>
                    </div>
                    {g.funder && <p className="text-xs text-gray-500 truncate mb-1">{g.funder}</p>}
                    <div className="flex gap-3 text-xs text-gray-600">
                      {(g.budget_line_count ?? 0) > 0 && (
                        <span>{g.budget_line_count} line{g.budget_line_count !== 1 ? "s" : ""}</span>
                      )}
                      {(g.checklist_failures ?? 0) > 0 && (
                        <span className="text-red-400 font-medium">⚠ {g.checklist_failures} failing</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── Detail panel ──────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          {detailLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !selected ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 px-6 text-center">
              <span className="text-4xl mb-1">🛡️</span>
              <p className="text-gray-400 font-medium">Select a grant to view its compliance detail</p>
              <p className="text-xs text-gray-600 max-w-xs">Track budget allocations vs. spend, manage funder checklist requirements, and maintain an immutable audit trail of all changes.</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6">

              {/* ── Grant header ─────────────────────────────────────────── */}
              <div className="flex items-start justify-between gap-4 mb-5">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold text-white leading-snug">{selected.grant.grant_name}</h2>
                  {selected.grant.funder && (
                    <p className="text-sm text-gray-400 mt-0.5">{selected.grant.funder}</p>
                  )}
                  {(selected.grant.period_start || selected.grant.period_end) && (
                    <p className="text-xs text-gray-500 mt-0.5 font-mono">
                      {selected.grant.period_start ?? "open"} → {selected.grant.period_end ?? "open"}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  {selected.grant.total_awarded != null && (
                    <span className="text-sm font-mono text-emerald-400 font-semibold">
                      {fmt(selected.grant.total_awarded)} awarded
                    </span>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Status:</span>
                    <select
                      value={selected.grant.status}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                        handleStatusChange(e.target.value as ComplianceGrant["status"])
                      }
                      className={`text-xs px-2 py-1 rounded-lg cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-500 border font-medium ${STATUS_COLORS[selected.grant.status]} bg-transparent`}
                    >
                      {(Object.keys(STATUS_LABELS) as ComplianceGrant["status"][]).map((s) => (
                        <option key={s} value={s} className="bg-gray-900 text-white font-normal">
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* ── Summary cards ────────────────────────────────────────── */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3.5">
                  <p className="text-xs text-gray-500 mb-1">Total Allocated</p>
                  <p className="text-lg font-mono font-semibold text-white">{fmt(totalAllocated)}</p>
                  {selected.grant.total_awarded != null && totalAllocated > 0 && (
                    <p className="text-xs text-gray-600 mt-0.5">
                      {Math.round((totalAllocated / selected.grant.total_awarded) * 100)}% of award
                    </p>
                  )}
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3.5">
                  <p className="text-xs text-gray-500 mb-1">Total Spent</p>
                  <p className={`text-lg font-mono font-semibold ${
                    totalSpent > totalAllocated && totalAllocated > 0 ? "text-red-400" : "text-white"
                  }`}>
                    {fmt(totalSpent)}
                  </p>
                  {totalAllocated > 0 && (
                    <p className={`text-xs mt-0.5 ${totalSpent > totalAllocated ? "text-red-500" : "text-gray-600"}`}>
                      {Math.round((totalSpent / totalAllocated) * 100)}% of budget
                      {totalSpent > totalAllocated && " ⚠ OVER"}
                    </p>
                  )}
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3.5">
                  <p className="text-xs text-gray-500 mb-1">Requirements</p>
                  <p className="text-lg font-mono font-semibold text-white">
                    {checklistTotal === 0 ? "—" : `${checklistPass}/${checklistTotal}`}
                  </p>
                  {checklistFail > 0 && (
                    <p className="text-xs text-red-400 mt-0.5 font-medium">{checklistFail} failing</p>
                  )}
                  {checklistTotal > 0 && checklistFail === 0 && (
                    <p className="text-xs text-gray-600 mt-0.5">
                      {checklistPass === checklistTotal ? "All passing ✓" : `${checklistTotal - checklistPass} pending`}
                    </p>
                  )}
                </div>
              </div>

              {/* ── Tabs ────────────────────────────────────────────────── */}
              <div className="flex border-b border-gray-800 mb-6" role="tablist">
                {(["budget", "checklist", "log"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                      tab === t
                        ? "border-brand-500 text-brand-400"
                        : "border-transparent text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {t === "log" ? "Audit Log" : t === "budget" ? "Budget" : "Checklist"}
                    {t === "log" && selected.auditLog.length > 0 && (
                      <span className="ml-1.5 text-xs text-gray-600">({selected.auditLog.length})</span>
                    )}
                    {t === "checklist" && checklistFail > 0 && (
                      <span className="ml-1.5 text-xs text-red-500">({checklistFail})</span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Budget tab ──────────────────────────────────────────── */}
              {tab === "budget" && (
                <div className="flex flex-col gap-5">
                  {selected.budgetLines.length === 0 ? (
                    <p className="text-sm text-gray-500">No budget lines yet. Use the form below to add spending categories.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {selected.budgetLines.map((line) => {
                        const over = line.spent > line.allocated && line.allocated > 0;
                        const pct = line.allocated > 0 ? Math.round((line.spent / line.allocated) * 100) : null;
                        return (
                          <div
                            key={line.id}
                            className={`bg-gray-900 border rounded-xl p-4 ${
                              over ? "border-red-800/60" : "border-gray-800"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-semibold text-white capitalize">{line.category}</span>
                              <button
                                onClick={() => editBudgetLine(line)}
                                className="text-xs text-gray-500 hover:text-brand-400 transition-colors"
                              >
                                Edit
                              </button>
                            </div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-400">
                                Spent: <span className={over ? "text-red-400 font-semibold" : "text-white font-medium"}>{fmt(line.spent)}</span>
                              </span>
                              <span className="text-gray-500">
                                Allocated: <span className="text-gray-300">{fmt(line.allocated)}</span>
                                {pct != null && <span className="ml-1 text-gray-600">({pct}%)</span>}
                              </span>
                            </div>
                            <BudgetBar allocated={line.allocated} spent={line.spent} />
                            {over && (
                              <p className="text-xs text-red-400 mt-1.5 font-medium">
                                ⚠ Over budget by {fmt(line.spent - line.allocated)}
                              </p>
                            )}
                            {line.notes && (
                              <p className="text-xs text-gray-500 mt-2 italic border-t border-gray-800 pt-2">{line.notes}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Budget form */}
                  <form
                    onSubmit={handleBudgetSubmit}
                    className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3"
                  >
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      {budgetForm.category ? `Editing "${budgetForm.category}"` : "Add / update budget line"}
                    </p>
                    {budgetError && (
                      <InlineError msg={budgetError} onDismiss={() => setBudgetError("")} />
                    )}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1" htmlFor="bl-category">Category <span className="text-red-400">*</span></label>
                      <input
                        id="bl-category"
                        required
                        placeholder="e.g. Programming, Personnel, Admin"
                        value={budgetForm.category}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBudgetForm((p) => ({ ...p, category: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1" htmlFor="bl-allocated">Allocated ($)</label>
                        <input
                          id="bl-allocated"
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0"
                          value={budgetForm.allocated}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBudgetForm((p) => ({ ...p, allocated: e.target.value }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1" htmlFor="bl-spent">Spent ($)</label>
                        <input
                          id="bl-spent"
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0"
                          value={budgetForm.spent}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBudgetForm((p) => ({ ...p, spent: e.target.value }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1" htmlFor="bl-notes">Notes</label>
                      <input
                        id="bl-notes"
                        placeholder="Optional context or discrepancy explanation"
                        value={budgetForm.notes}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBudgetForm((p) => ({ ...p, notes: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                      />
                    </div>
                    <div className="flex gap-2">
                      {budgetForm.category && (
                        <button
                          type="button"
                          onClick={() => { setBudgetForm(BLANK_BUDGET); setBudgetError(""); }}
                          className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm py-2 rounded-lg transition-colors"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={budgetSaving || !budgetForm.category.trim()}
                        className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm py-2 rounded-lg transition-colors"
                      >
                        {budgetSaving ? "Saving…" : "Save Line"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* ── Checklist tab ────────────────────────────────────────── */}
              {tab === "checklist" && (
                <div className="flex flex-col gap-4">
                  {checklistError && (
                    <InlineError msg={checklistError} onDismiss={() => setChecklistError("")} />
                  )}

                  {selected.checklist.length === 0 ? (
                    <p className="text-sm text-gray-500">No requirements added yet. Enter funder conditions below.</p>
                  ) : (
                    <ul className="flex flex-col gap-2" role="list">
                      {selected.checklist.map((item) => (
                        <li
                          key={item.id}
                          className={`bg-gray-900 border rounded-xl p-3.5 flex items-start justify-between gap-3 ${
                            item.status === "fail" ? "border-red-800/60" : "border-gray-800"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <span className={`text-sm leading-snug ${
                              item.status === "fail" ? "text-red-300" :
                              item.status === "pass" ? "text-emerald-300" :
                              "text-gray-300"
                            }`}>
                              {item.item}
                            </span>
                            {item.checked_by && (
                              <p className="text-xs text-gray-600 mt-0.5">
                                {item.checked_by} · {item.checked_at ? new Date(item.checked_at).toLocaleDateString() : ""}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0" role="group" aria-label={`Status for: ${item.item}`}>
                            {(Object.keys(CHECKLIST_STATUS_LABELS) as ChecklistItem["status"][]).map((s) => (
                              <button
                                key={s}
                                onClick={() => handleChecklistStatus(item.id, s)}
                                className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${
                                  item.status === s
                                    ? CHECKLIST_BUTTON_STYLES[s]
                                    : "border-gray-700 text-gray-600 hover:text-gray-400"
                                }`}
                                aria-pressed={item.status === s}
                              >
                                {CHECKLIST_STATUS_LABELS[s]}
                              </button>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <form onSubmit={handleChecklistAdd} className="flex gap-2">
                    <div className="flex-1">
                      <label className="sr-only" htmlFor="cl-item">New requirement</label>
                      <input
                        id="cl-item"
                        placeholder="Add funder requirement (e.g. 100% of funds used for programming activities)"
                        value={newItem}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewItem(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={itemSaving || !newItem.trim()}
                      className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                    >
                      {itemSaving ? "…" : "Add Item"}
                    </button>
                  </form>
                </div>
              )}

              {/* ── Audit log tab ────────────────────────────────────────── */}
              {tab === "log" && (
                <div className="flex flex-col gap-5">
                  {/* Remediation note entry */}
                  <form onSubmit={handleNoteSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Add Remediation Note</p>
                    {noteError && (
                      <InlineError msg={noteError} onDismiss={() => setNoteError("")} />
                    )}
                    <div>
                      <label className="sr-only" htmlFor="note-text">Remediation note</label>
                      <textarea
                        id="note-text"
                        rows={3}
                        placeholder="Document corrective action taken, audit findings, or steps toward resolution…"
                        value={note}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={noteSaving || !note.trim()}
                      className="self-end bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-2 rounded-lg transition-colors"
                    >
                      {noteSaving ? "Logging…" : "Log Note"}
                    </button>
                  </form>

                  {/* Event timeline */}
                  {selected.auditLog.length === 0 ? (
                    <p className="text-sm text-gray-500">No events recorded yet. All budget changes, status updates, and checklist actions are automatically logged here.</p>
                  ) : (
                    <ol className="relative border-l border-gray-800 ml-3 flex flex-col" aria-label="Audit event timeline">
                      {selected.auditLog.map((ev) => (
                        <li key={ev.id} className="ml-5 pb-5 last:pb-0">
                          <span className="absolute -left-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 border border-gray-700 text-xs select-none" aria-hidden="true">
                            {EVENT_ICONS[ev.event_type] ?? "•"}
                          </span>
                          <p className="text-sm text-gray-200 leading-snug">{ev.description}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            <span className="font-medium text-gray-400">{ev.actor}</span>
                            {" · "}
                            {new Date(ev.created_at).toLocaleString()}
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
