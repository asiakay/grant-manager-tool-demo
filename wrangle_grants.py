#!/usr/bin/env python3
"""
wrangle_grants.py — Merge all CSVs in a folder into one master CSV.

Usage:
  python wrangle_grants.py --input data/csvs --out out/master.csv
  python wrangle_grants.py --input data/csvs --out out/master.csv --dedup-key Link
  python wrangle_grants.py --input data/csvs --out out/master.csv --pattern "*.csv"
  python wrangle_grants.py --input data/csvs --out out/master.csv --strict
"""

from __future__ import annotations
import argparse
import csv
import glob
import os
import sys
from pathlib import Path
from typing import List, Tuple, Dict, Any


def read_csv(path: str, delimiter: str = ",", encoding: str = "utf-8") -> Tuple[List[str], List[Dict[str, Any]]]:
    with open(path, newline="", encoding=encoding) as f:
        r = csv.DictReader(f, delimiter=delimiter)
        fieldnames = list(r.fieldnames or [])
        rows = list(r)
        return fieldnames, rows


def union_headers(headers_list: List[List[str]]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for headers in headers_list:
        for h in headers:
            if h not in seen:
                seen.add(h)
                ordered.append(h)
    return ordered


def normalize_rows(rows: List[Dict[str, Any]], all_headers: List[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append({h: r.get(h, "") for h in all_headers})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Merge CSVs in a folder into one master CSV")
    ap.add_argument("--input", dest="in_dir", default="data/csvs", help="Folder containing CSVs to merge")
    ap.add_argument("--out", dest="out_file", default="out/master.csv", help="Output CSV file path")
    ap.add_argument("--pattern", dest="pattern", default="*.csv", help='Glob pattern to match files (default: "*.csv")')
    ap.add_argument("--dedup-key", dest="dedup_key", default="", help="Optional column name to de-duplicate on (first wins)")
    ap.add_argument("--delimiter", dest="delimiter", default=",", help='CSV delimiter (default: ",")')
    ap.add_argument("--encoding", dest="encoding", default="utf-8", help='File encoding (default: "utf-8")')
    ap.add_argument("--strict", action="store_true", help="Fail if any file cannot be read")
    args = ap.parse_args()

    in_dir = args.in_dir
    out_file = args.out_file
    pattern = args.pattern

    files = sorted(glob.glob(os.path.join(in_dir, pattern)))
    if not files:
        print(f"ERROR: No CSV files found in {in_dir} matching {pattern}")
        sys.exit(2)

    print(f"INFO: Found {len(files)} CSV file(s) in {in_dir} matching {pattern}")

    headers_list: List[List[str]] = []
    all_rows: List[Dict[str, Any]] = []
    loaded = 0
    for fp in files:
        p = Path(fp)
        if not p.is_file():
            # Shouldn't happen with glob, but be safe.
            msg = f"WARNING: Skipping non-file path: {fp}"
            if args.strict:
                print(msg.replace("WARNING", "ERROR"))
                sys.exit(1)
            print(msg)
            continue
        try:
            headers, rows = read_csv(fp, delimiter=args.delimiter, encoding=args.encoding)
            if not headers:
                print(f"WARNING: {fp} has no header row; skipping")
                if args.strict:
                    print("ERROR: Strict mode enabled; aborting due to headerless CSV.")
                    sys.exit(1)
                continue
            print(f"INFO: Loaded {fp} ({len(rows)} rows)")
            headers_list.append(headers)
            all_rows.extend(rows)
            loaded += 1
        except Exception as e:
            msg = f"WARNING: Could not read file: {fp} ({e})"
            if args.strict:
                print(msg.replace("WARNING", "ERROR"))
                sys.exit(1)
            print(msg)

    if loaded == 0:
        print("ERROR: No readable CSVs; nothing to merge.")
        sys.exit(2)

    union = union_headers(headers_list)
    normalized = normalize_rows(all_rows, union)

    # Optional de-duplication by a given column
    if args.dedup_key:
        if args.dedup_key not in union:
            print(f"WARNING: dedup-key '{args.dedup_key}' not found in columns; skipping de-dup.")
        else:
            seen = set()
            deduped: List[Dict[str, Any]] = []
            for r in normalized:
                key = r.get(args.dedup_key, "")
                if key not in seen:
                    seen.add(key)
                    deduped.append(r)
            print(f"INFO: De-duplicated on '{args.dedup_key}': {len(normalized)} → {len(deduped)} rows")
            normalized = deduped

    # Write output
    Path(out_file).parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", newline="", encoding=args.encoding) as f:
        w = csv.DictWriter(f, fieldnames=union, delimiter=args.delimiter)
        w.writeheader()
        w.writerows(normalized)

    print(f"OK: Merged {loaded} file(s) → {out_file} ({len(normalized)} rows)")
    sys.exit(0)


if __name__ == "__main__":
    main()
