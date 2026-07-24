import { useState, type FormEvent } from "react";
import React from "react";
import type { Grant } from "../types";
import { mergedSearch, type SearchSource } from "../api";
import type { UserProfile } from "../api";
import DeadlineBadge from "./DeadlineBadge";

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

const SOURCE_LABELS: Record<SearchSource, string> = {
  all:     "All Sources",
  federal: "Federal (Grants.gov)",
  ngo:     "Foundation & NGO",
};

const SOURCE_CHANNEL_BADGE: Record<string, { label: string; className: string }> = {
  foundation:          { label: "Foundation",        className: "bg-purple-900/40 text-purple-300" },
  corporate:           { label: "Corporate",         className: "bg-amber-900/40 text-amber-300"   },
  community_foundation:{ label: "Community Fdn",     className: "bg-teal-900/40 text-teal-300"     },
  simpler_api:         { label: "Federal",           className: "bg-blue-900/40 text-blue-300"     },
  xml_extract:         { label: "Federal",           className: "bg-blue-900/40 text-blue-300"     },
  federal:             { label: "Federal",           className: "bg-blue-900/40 text-blue-300"     },
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
  const [source, setSource] = useState<SearchSource>("all");
  const [results, setResults] = useState<Grant[]>([]);
  const [total, setTotal] = useState(0);
  const [federalTotal, setFederalTotal] = useState(0);
  const [ngoTotal, setNgoTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [federalUnconfigured, setFederalUnconfigured] = useState(false);

  const suggestions = (profile?.focusAreas ?? []).map(fa => ({
    label: fa,
    query: FOCUS_AREA_QUERIES[fa] ?? fa,
  }));

  const PAGE_SIZE = 25;

  async function runSearch(q: string, src: SearchSource, p: number) {
    setLoading(true);
    setError("");
    try {
      const res = await mergedSearch(q, src, p, PAGE_SIZE);
      setFederalUnconfigured(!res.configured && src !== "ngo");
      setResults(res.data);
      setTotal(res.total);
      setFederalTotal(res.federalTotal);
      setNgoTotal(res.ngoTotal);
      setPage(p);
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
    runSearch(query, source, 1);
  }

  function handleSourceChange(s: SearchSource) {
    setSource(s);
    if (searched && query.trim()) {
      setPage(1);
      runSearch(query, s, 1);
    }
  }

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <section aria-label="Live grant search" className="card space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-white">Live Search</h2>
        <span className="badge bg-gray-800 text-gray-400 text-xs">Beta</span>
      </div>

      {/* Source filter tabs */}
      <div className="flex gap-1 p-1 bg-gray-800/60 rounded-lg w-fit" role="group" aria-label="Search source">
        {(Object.keys(SOURCE_LABELS) as SearchSource[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => handleSourceChange(s)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              source === s
                ? "bg-brand-600 text-white shadow"
                : "text-gray-400 hover:text-gray-200"
            }`}
            aria-pressed={source === s}
          >
            {SOURCE_LABELS[s]}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2" role="search" aria-label="Search grants">
        <label htmlFor="live-search-input" className="sr-only">Search for grants</label>
        <input
          id="live-search-input"
          className="input flex-1"
          placeholder={
            source === "federal" ? "e.g. workforce development, climate resilience…"
            : source === "ngo"   ? "e.g. cooperative, solar, community health…"
            : "Search federal grants and foundations…"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="btn-primary shrink-0 gap-2"
          aria-label="Search grants"
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
              onClick={() => { setQuery(sq); runSearch(sq, source, 1); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {federalUnconfigured && source !== "ngo" && (
        <div className="bg-yellow-900/20 border border-yellow-700/50 text-yellow-300 rounded-lg px-3 py-2 text-xs" role="status">
          Federal search (Simpler Grants.gov) requires a <code>SIMPLER_GRANTS_API_KEY</code> secret. Foundation & NGO results still available.
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
          <div className="flex items-center gap-3 flex-wrap" aria-live="polite">
            <p className="text-gray-500 text-xs">
              Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()} opportunities
            </p>
            {source === "all" && (
              <div className="flex gap-2">
                {federalTotal > 0 && (
                  <span className="badge bg-blue-900/30 text-blue-300 text-xs">{federalTotal.toLocaleString()} federal</span>
                )}
                {ngoTotal > 0 && (
                  <span className="badge bg-purple-900/30 text-purple-300 text-xs">{ngoTotal.toLocaleString()} foundation/NGO</span>
                )}
              </div>
            )}
          </div>

          <ul className="space-y-2" aria-label="Search results">
            {results.map((grant) => {
              const name = String(grant.Name);
              const isCandidate = candidates.has(name);
              const isWatchlisted = watchlist.has(name);
              const channel = String(grant["Source Channel"] || "").toLowerCase();
              const channelBadge = SOURCE_CHANNEL_BADGE[channel];
              return (
                <li
                  key={name}
                  className="flex items-start gap-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-colors px-3 py-3 cursor-pointer"
                  onClick={() => onRowClick(grant)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      {channelBadge && (
                        <span className={`badge text-xs ${channelBadge.className}`}>{channelBadge.label}</span>
                      )}
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

                  <div className="flex items-center gap-1 shrink-0 mt-0.5" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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
                        aria-label={`View ${name} (opens in new tab)`}
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
                onClick={() => runSearch(query, source, page - 1)}
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
                onClick={() => runSearch(query, source, page + 1)}
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
