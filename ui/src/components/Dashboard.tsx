import { useCallback, useEffect, useState } from "react";
import type { Grant, FilterState } from "../types";
import { fetchGrants, logout, exportCsv } from "../api";
import SummaryCards from "./SummaryCards";
import GrantTable from "./GrantTable";
import GrantDrawer from "./GrantDrawer";
import ChatPanel from "./ChatPanel";

const WATCHLIST_KEY = "gm_watchlist";
const CANDIDATES_KEY = "gm_candidates";

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveSet(key: string, s: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...s]));
}

interface Props {
  onLogout: () => void;
}

const INITIAL_FILTERS: FilterState = {
  type: "",
  stage: "",
  minScore: "",
  deadlineBefore: "",
  search: "",
};

export default function Dashboard({ onLogout }: Props) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [selectedGrant, setSelectedGrant] = useState<Grant | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const [watchlist, setWatchlist] = useState<Set<string>>(() => loadSet(WATCHLIST_KEY));
  const [candidates, setCandidates] = useState<Set<string>>(() => loadSet(CANDIDATES_KEY));

  useEffect(() => {
    fetchGrants()
      .then(setGrants)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = useCallback(async () => {
    await logout().catch(() => {});
    onLogout();
  }, [onLogout]);

  const toggleWatchlist = useCallback((name: string) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      saveSet(WATCHLIST_KEY, next);
      return next;
    });
  }, []);

  const toggleCandidate = useCallback((name: string) => {
    setCandidates((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      saveSet(CANDIDATES_KEY, next);
      return next;
    });
  }, []);

  const handleGrantUpdated = useCallback((name: string, notes: string) => {
    setGrants((prev) =>
      prev.map((g) => (g.Name === name ? { ...g, "Notes/Actions": notes } : g))
    );
  }, []);

  const types = [...new Set(grants.map((g) => g.Type).filter(Boolean))].sort();
  const stages = [...new Set(grants.map((g) => g.Stage).filter(Boolean))].sort();

  const activeFilterCount = Object.entries(filters).filter(
    ([, v]) => v !== ""
  ).length;

  async function handleExport() {
    try {
      await exportCsv();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Export failed");
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Topbar */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 lg:px-6 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">💰</span>
          <div>
            <h1 className="text-base font-semibold text-white leading-tight">Grant Manager</h1>
            {!loading && (
              <p className="text-gray-500 text-xs">{grants.length} programs loaded</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="btn-outline hidden sm:flex gap-1.5"
            title="Export CSV"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>

          <button
            onClick={() => setChatOpen(true)}
            className="btn-primary gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="hidden sm:inline">AI Chat</span>
          </button>

          <button
            onClick={handleLogout}
            className="btn-ghost px-2.5"
            title="Sign out"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto px-4 lg:px-6 py-5 space-y-5">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 text-sm">Loading grants…</p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-xl px-4 py-3 text-sm">
            <strong>Error loading grants:</strong> {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <SummaryCards grants={grants} />

            {/* Filters */}
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="ml-2 badge bg-brand-600/30 text-brand-300">
                      {activeFilterCount} active
                    </span>
                  )}
                </h2>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => setFilters(INITIAL_FILTERS)}
                    className="text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="col-span-2 sm:col-span-3 lg:col-span-1">
                  <input
                    className="input"
                    placeholder="Search name, sponsor…"
                    value={filters.search}
                    onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  />
                </div>

                <select
                  className="input"
                  value={filters.type}
                  onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
                >
                  <option value="">All Types</option>
                  {types.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>

                <select
                  className="input"
                  value={filters.stage}
                  onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}
                >
                  <option value="">All Stages</option>
                  {stages.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>

                <div>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    placeholder="Min score (0–10)"
                    value={filters.minScore}
                    onChange={(e) => setFilters((f) => ({ ...f, minScore: e.target.value }))}
                  />
                </div>

                <div>
                  <input
                    className="input"
                    type="date"
                    title="Deadline before"
                    value={filters.deadlineBefore}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, deadlineBefore: e.target.value }))
                    }
                  />
                </div>
              </div>

              {(watchlist.size > 0 || candidates.size > 0) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {candidates.size > 0 && (
                    <span className="badge bg-brand-900/50 text-brand-300">
                      ★ {candidates.size} candidate{candidates.size !== 1 ? "s" : ""}
                    </span>
                  )}
                  {watchlist.size > 0 && (
                    <span className="badge bg-blue-900/50 text-blue-300">
                      👁 {watchlist.size} on watchlist
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Table */}
            <div className="card p-0 overflow-hidden">
              <GrantTable
                grants={grants}
                filters={filters}
                watchlist={watchlist}
                candidates={candidates}
                onRowClick={setSelectedGrant}
                onToggleWatchlist={toggleWatchlist}
                onToggleCandidate={toggleCandidate}
              />
            </div>
          </>
        )}
      </main>

      {/* Drawer */}
      <GrantDrawer
        grant={selectedGrant}
        onClose={() => setSelectedGrant(null)}
        onGrantUpdated={handleGrantUpdated}
      />

      {/* Chat panel */}
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
