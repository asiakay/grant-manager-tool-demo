import { useState, useMemo, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";

import type { Grant, FilterState } from "../types";
import DeadlineBadge from "./DeadlineBadge";

const PAGE_SIZE = 25;

interface Props {
  grants: Grant[];
  filters: FilterState;
  watchlist: Set<string>;
  candidates: Set<string>;
  onRowClick: (grant: Grant) => void;
  onToggleWatchlist: (name: string) => void;
  onToggleCandidate: (name: string) => void;
}

const columnHelper = createColumnHelper<Grant>();

function ScoreCell({ value, max = 5 }: { value: string | number; max?: number }) {
  const n = parseFloat(String(value));
  if (isNaN(n)) return <span className="text-gray-500" aria-label="No score">—</span>;
  const pct = n / max;
  const color =
    pct >= 0.65
      ? "text-green-400"
      : pct >= 0.35
        ? "text-yellow-400"
        : "text-red-400";
  const level = pct >= 0.65 ? "high" : pct >= 0.35 ? "medium" : "low";
  return (
    <>
      <span className={`font-semibold ${color}`} aria-hidden="true">{n.toFixed(1)}</span>
      <span className="sr-only">{n.toFixed(1)} out of {max}, {level}</span>
    </>
  );
}

function BoolCell({ value }: { value: string | number }) {
  const s = String(value || "").toLowerCase();
  const yes = s === "yes" || s === "true" || s === "y";
  const no = s === "no" || s === "false" || s === "n";
  if (yes) return <span className="badge bg-green-900/50 text-green-300">Yes</span>;
  if (no) return <span className="badge bg-red-900/50 text-red-300">No</span>;
  return <span className="text-gray-400 text-xs">{value || "—"}</span>;
}

// DeadlineCell delegates to the shared DeadlineBadge component
function DeadlineCell({ value }: { value: string | number }) {
  return <DeadlineBadge value={value} />;
}

export default function GrantTable({
  grants,
  filters,
  watchlist,
  candidates,
  onRowClick,
  onToggleWatchlist,
  onToggleCandidate,
}: Props) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "score", desc: true },
  ]);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [filters, grants]);

  const filtered = useMemo(() => {
    return grants.filter((g) => {
      const name = String(g.Name);
      if (filters.savedOnly && !candidates.has(name) && !watchlist.has(name)) return false;
      if (filters.type && g.Type !== filters.type) return false;
      if (filters.stage && g.Stage !== filters.stage) return false;
      if (filters.minScore) {
        const score = parseFloat(String(g.score ?? g["Weighted Score"] ?? "0"));
        if (score < parseFloat(filters.minScore)) return false;
      }
      if (filters.deadlineBefore) {
        const deadline = new Date(String(g["Deadline/Next Cohort"] || ""));
        const cutoff = new Date(filters.deadlineBefore);
        if (isNaN(deadline.getTime()) || deadline > cutoff) return false;
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        return (
          String(g.Name || "").toLowerCase().includes(q) ||
          String(g.Sponsor || "").toLowerCase().includes(q) ||
          String(g.Benefits || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [grants, filters, candidates, watchlist]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("Name", {
        header: "Name",
        cell: (info) => (
          <span className="font-medium text-white text-sm line-clamp-2 leading-snug">
            {info.getValue()}
          </span>
        ),
        size: 200,
        meta: { className: "" },
      }),
      columnHelper.accessor("Type", {
        header: "Type",
        cell: (info) => (
          <span className="badge bg-gray-800 text-gray-300 text-xs whitespace-nowrap">
            {info.getValue() || "—"}
          </span>
        ),
        size: 90,
        meta: { className: "hidden xl:table-cell" },
      }),
      columnHelper.accessor("Sponsor", {
        header: "Sponsor",
        cell: (info) => (
          <span className="text-gray-300 text-xs line-clamp-1">{info.getValue() || "—"}</span>
        ),
        size: 140,
        meta: { className: "hidden md:table-cell" },
      }),
      columnHelper.accessor("Stage", {
        header: "Stage",
        cell: (info) => (
          <span className="text-gray-400 text-xs">{info.getValue() || "—"}</span>
        ),
        size: 90,
        meta: { className: "hidden lg:table-cell" },
      }),
      columnHelper.accessor("Deadline/Next Cohort", {
        header: "Deadline",
        cell: (info) => <DeadlineCell value={info.getValue()} />,
        size: 110,
        sortingFn: (a, b) => {
          const da = new Date(String(a.original["Deadline/Next Cohort"] || "")).getTime();
          const db = new Date(String(b.original["Deadline/Next Cohort"] || "")).getTime();
          return (isNaN(da) ? Infinity : da) - (isNaN(db) ? Infinity : db);
        },
        meta: { className: "hidden sm:table-cell" },
      }),
      columnHelper.accessor("Non-dilutive?", {
        header: "Non-dilutive",
        cell: (info) => <BoolCell value={info.getValue()} />,
        size: 100,
        meta: { className: "hidden xl:table-cell" },
      }),
      columnHelper.accessor("Relevance", {
        header: "Rel",
        cell: (info) => <ScoreCell value={info.getValue()} max={3} />,
        size: 55,
        meta: { className: "hidden lg:table-cell" },
      }),
      columnHelper.accessor("Fit", {
        header: "Fit",
        cell: (info) => <ScoreCell value={info.getValue()} max={3} />,
        size: 50,
        meta: { className: "hidden lg:table-cell" },
      }),
      columnHelper.accessor("Ease", {
        header: "Ease",
        cell: (info) => <ScoreCell value={info.getValue()} max={3} />,
        size: 55,
        meta: { className: "hidden lg:table-cell" },
      }),
      columnHelper.accessor("score", {
        header: "Match ★",
        cell: (info) => <ScoreCell value={info.getValue() ?? 0} max={3} />,
        size: 65,
        sortingFn: (a, b) => {
          const sa = parseFloat(String(a.original.score ?? "0"));
          const sb = parseFloat(String(b.original.score ?? "0"));
          return sa - sb;
        },
        meta: { className: "" },
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const name = String(row.original.Name);
          const isCandidate = candidates.has(name);
          const isWatchlisted = watchlist.has(name);
          return (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                aria-label={isCandidate ? `Remove ${name} from candidates` : `Mark ${name} as candidate`}
                aria-pressed={isCandidate}
                onClick={() => onToggleCandidate(name)}
                className={`p-1 rounded transition-colors text-base leading-none ${isCandidate ? "text-brand-400" : "text-gray-600 hover:text-gray-400"}`}
              >
                <span aria-hidden="true">★</span>
              </button>
              <button
                aria-label={isWatchlisted ? `Remove ${name} from watchlist` : `Add ${name} to watchlist`}
                aria-pressed={isWatchlisted}
                onClick={() => onToggleWatchlist(name)}
                className={`p-1 rounded transition-colors text-sm leading-none ${isWatchlisted ? "text-blue-400" : "text-gray-600 hover:text-gray-400"}`}
              >
                <span aria-hidden="true">👁</span>
              </button>
            </div>
          );
        },
        size: 60,
        meta: { className: "" },
      }),
    ],
    [candidates, watchlist, onToggleCandidate, onToggleWatchlist]
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const allSortedRows = table.getRowModel().rows;
  const pageCount = Math.max(1, Math.ceil(allSortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = allSortedRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <span className="text-4xl mb-3">🔍</span>
        <p className="font-medium">No grants match your filters</p>
        <p className="text-sm mt-1">Try adjusting your search criteria</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-0" aria-label="Grant opportunities">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const ariaSort = sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : header.column.getCanSort() ? "none" : undefined;
                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    aria-sort={ariaSort}
                    className={`sticky top-0 bg-gray-900 px-3 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-800 whitespace-nowrap ${header.column.getCanSort() ? "cursor-pointer select-none hover:text-gray-200" : ""} ${(header.column.columnDef.meta as { className?: string })?.className ?? ""}`}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === "asc" && <span aria-hidden="true"> ↑</span>}
                      {sorted === "desc" && <span aria-hidden="true"> ↓</span>}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {pageRows.map((row) => {
            const name = String(row.original.Name);
            const isCandidate = candidates.has(name);
            const isWatchlisted = watchlist.has(name);
            return (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.original)}
                className={`cursor-pointer transition-colors border-b border-gray-800/50 hover:bg-gray-800/60 ${isCandidate ? "bg-brand-900/10" : isWatchlisted ? "bg-blue-900/10" : ""}`}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={`px-3 py-2.5 align-middle max-w-xs ${(cell.column.columnDef.meta as { className?: string })?.className ?? ""}`}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-3 py-2.5 border-t border-gray-800 text-xs text-gray-500">
        <span aria-live="polite" aria-atomic="true">
          {filtered.length === grants.length
            ? `${grants.length} grants`
            : `${filtered.length} of ${grants.length} grants`}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2" role="navigation" aria-label="Pagination">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              aria-label="Previous page"
              className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ‹ Prev
            </button>
            <span className="tabular-nums" aria-live="polite" aria-atomic="true">
              Page {safePage} of {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={safePage === pageCount}
              aria-label="Next page"
              className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
