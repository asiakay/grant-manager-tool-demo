import { useState, type FormEvent } from "react";
import type { Grant } from "../types";
import { liveSearch } from "../api";
import type { UserProfile } from "../api";
import DeadlineBadge from "./DeadlineBadge";

// Maps focus area labels to effective search terms for Simpler Grants API.
const FOCUS_AREA_QUERIES: Record<string, string> = {
  "Health & Medicine":         "health medicine clinical",
  "Education & Workforce":     "education workforce training",
  "Technology & Innovation":   "technology innovation research",
  "Housing & Community":       "affordable housing community development",
  "Environment & Climate":     "climate environment clean energy",
  "Agriculture & Food":        "agriculture food rural",
  "Social Services":           "social services community welfare",
  "Arts & Humanities":         "arts humanities culture",
  "International Development": "international development global",
  "Veterans & Military":       "veterans military service members",
  "Research & Science":        "research science scientific",
  "Justice & Safety":          "justice safety equity law",
};

interface Props {
  watchlist: Set<string>;
  candidates: Set<string>;
  onToggleWatchlist: (name: string) => void;
  onToggleCandidate: (name: string) => void;
  onRowClick: (grant: Grant) => void;
  profile?: UserProfile | null;
}

export default function LiveSearch({ watchlist, candidates, onToggleWatchlist, onToggleCandidate, onRowClick, profile }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Grant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const suggestions = (profile?.focusAreas ?? []).map(fa => ({
    label: fa,
    query: FOCUS_AREA_QUERIES[fa] ?? fa,
  }));

  const PAGE_SIZE = 25;

  async function runSearch(q: string, p: number) {
    setLoading(true);
    setError("");
    try {
      const res = await liveSearch(q, p, PAGE_SIZE);
      if (!res.configured) {
        setError("Live search requires a SIMPLER_GRANTS_API_KEY secret. See wrangler.toml for setup instructions.");
        setResults([]);
        setTotal(0);
      } else {
        setResults(res.data);
        setTotal(res.total);
        setPage(p);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setPage(1);
    runSearch(query, 1);
  }

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <section aria-label="Live grant search from Simpler Grants.gov" className="card space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-white">Live Search — Simpler Grants.gov</h2>
        <span className="badge bg-gray-800 text-gray-400 text-xs">Beta</span>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2" role="search" aria-label="Search Simpler Grants.gov">
        <label htmlFor="live-search-input" className="sr-only">Search for grants on Simpler Grants.gov</label>
        <input
          id="live-search-input"
          className="input flex-1"
          placeholder="e.g. workforce development, climate resilience…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="btn-primary shrink-0 gap-2"
          aria-label="Search Simpler Grants.gov"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
              <span>Searching…</span>
            </>
          ) : (
            "Search"
          )}
        </button>
      </form>

      {suggestions.length > 0 && !searched && (
        <div className="flex flex-wrap gap-2">
          <span className="text-gray-500 text-xs self-center">From your profile:</span>
          {suggestions.map(({ label, query: sq }) => (
            <button
              key={label}
              type="button"
              className="px-2.5 py-1 rounded-full text-xs bg-brand-900/40 text-brand-300 border border-brand-700/40 hover:bg-brand-800/50 transition-colors"
              onClick={() => { setQuery(sq); runSearch(sq, 1); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm" role="alert">
          {error}
        </div>
      )}

      {searched && !loading && !error && results.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-4">No results found for "{query}".</p>
      )}

      {results.length > 0 && (
        <>
          <p className="text-gray-500 text-xs" aria-live="polite">
            Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()} opportunities from Simpler Grants.gov
          </p>

          <ul className="space-y-2" aria-label="Live search results">
            {results.map((grant) => {
              const name = String(grant.Name);
              const isCandidate = candidates.has(name);
              const isWatchlisted = watchlist.has(name);
              return (
                <li
                  key={name}
                  className="flex items-start gap-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-colors px-3 py-3 cursor-pointer"
                  onClick={() => onRowClick(grant)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      {grant.Type && (
                        <span className="badge bg-gray-700 text-gray-300 text-xs">{grant.Type}</span>
                      )}
                      {grant.Stage && (
                        <span className="badge bg-blue-900/40 text-blue-300 text-xs">{grant.Stage}</span>
                      )}
                    </div>
                    <p className="text-white text-sm font-medium leading-snug">{name}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{grant.Sponsor}</p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {grant["Deadline/Next Cohort"] && (
                        <DeadlineBadge value={grant["Deadline/Next Cohort"]} />
                      )}
                      {grant.Benefits && (
                        <span className="text-green-400 text-xs font-medium">{grant.Benefits}</span>
                      )}
                      {grant["Eligibility (key conditions)"] && (
                        <span className="text-gray-500 text-xs line-clamp-1">{grant["Eligibility (key conditions)"]}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      aria-label={isCandidate ? `Remove ${name} from candidates` : `Mark ${name} as candidate`}
                      aria-pressed={isCandidate}
                      onClick={() => onToggleCandidate(name)}
                      className={`p-1.5 rounded transition-colors text-base leading-none ${isCandidate ? "text-brand-400" : "text-gray-600 hover:text-gray-400"}`}
                    >
                      <span aria-hidden="true">★</span>
                    </button>
                    <button
                      aria-label={isWatchlisted ? `Remove ${name} from watchlist` : `Add ${name} to watchlist`}
                      aria-pressed={isWatchlisted}
                      onClick={() => onToggleWatchlist(name)}
                      className={`p-1.5 rounded transition-colors text-sm leading-none ${isWatchlisted ? "text-blue-400" : "text-gray-600 hover:text-gray-400"}`}
                    >
                      <span aria-hidden="true">👁</span>
                    </button>
                    {grant["Source URL"] && (
                      <a
                        href={String(grant["Source URL"])}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View ${name} on Grants.gov (opens in new tab)`}
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 rounded text-gray-600 hover:text-brand-400 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3" role="navigation" aria-label="Search results pagination">
              <button
                onClick={() => runSearch(query, page - 1)}
                disabled={page === 1 || loading}
                aria-label="Previous page of results"
                className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ‹ Prev
              </button>
              <span className="text-xs text-gray-500 tabular-nums" aria-live="polite" aria-atomic="true">
                Page {page} of {pageCount}
              </span>
              <button
                onClick={() => runSearch(query, page + 1)}
                disabled={page === pageCount || loading}
                aria-label="Next page of results"
                className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next ›
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
