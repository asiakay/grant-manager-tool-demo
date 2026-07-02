#!/usr/bin/env python3
"""import_to_d1.py — Load a scored programs CSV into the Cloudflare D1 programs table.

Usage:
  python import_to_d1.py scored.csv
  python import_to_d1.py scored.csv --env local
  python import_to_d1.py scored.csv --dry-run
  python import_to_d1.py scored.csv --env remote --wrangler /path/to/wrangler

The script:
  1. Reads the CSV and resolves human-readable headers ("Source URL", "Award
     Ceiling", ...) to the real snake_case D1 column names, mirroring the alias
     table worker.js's admin CSV-upload endpoint uses (CSV_COLUMN_ALIASES).
  2. Validates that the "name" column is present.
  3. Generates idempotent UPSERT SQL in batches of 50, matching each row against
     an existing D1 row by opportunity_id first (Grants.gov's stable ID, when
     present), falling back to name — so rows from the XML extract, the Simpler
     Grants.gov API sync, and legacy name-only CSVs can all coexist and update
     the same table without duplicating or orphaning each other.
  4. Never overwrites notes / ai_score / ai_summary / ai_tier / ai_scored_at /
     pdf_url — those columns are user- or AI-scoring-owned in D1 and must
     survive a pipeline re-import untouched.
"""

from __future__ import annotations

import argparse
import datetime
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

# Import column normalisation from program_scoring to avoid duplication.
from program_scoring import _normalize_columns

# snake_case D1 columns this script can write, and how to coerce a raw CSV
# string into a SQL literal for each. Deliberately excludes columns this
# script must never touch: id (surrogate PK), notes, pdf_url, ai_score,
# ai_summary, ai_tier, ai_scored_at (owned by the user / AI scoring pass).
D1_COLUMN_TYPES: Dict[str, str] = {
    "type": "TEXT",
    "name": "TEXT",
    "sponsor": "TEXT",
    "source_url": "TEXT",
    "region_eligibility": "TEXT",
    "deadline": "TEXT",
    "cadence": "TEXT",
    "benefits": "TEXT",
    "eligibility_conditions": "TEXT",
    "stage": "TEXT",
    "non_dilutive": "BOOL",
    "stack_required": "BOOL",
    "relevance": "REAL",
    "fit": "REAL",
    "ease": "REAL",
    "weighted_score": "REAL",
    "opportunity_id": "NULLABLE_TEXT",  # blank must be SQL NULL, not '' — see idx_programs_opportunity_id
    "opportunity_number": "TEXT",
    "cfda_numbers": "TEXT",
    "eligible_applicants": "TEXT",
    "award_ceiling": "REAL",
    "award_floor": "REAL",
    "is_forecast": "BOOL",
    "estimated_post_date": "TEXT",
    "source_channel": "TEXT",
}

# Columns that are pipeline metadata, not sourced from the CSV — stamped on every import.
METADATA_COLUMNS = ["last_synced_at"]

# User-/AI-owned columns: read-modify preserved, never written by this script.
PRESERVED_COLUMNS = ["notes", "pdf_url", "ai_score", "ai_summary", "ai_tier", "ai_scored_at"]

# Maps normalized (lowercased, whitespace-stripped) human-readable CSV headers to
# real D1 column names. Kept in sync with CSV_COLUMN_ALIASES in worker.js so the
# JS admin-CSV-upload path and this Python pipeline path resolve headers identically.
CSV_COLUMN_ALIASES: Dict[str, str] = {
    "grantname": "name",
    "easeofuse": "ease",
    "link": "source_url",
    "sourceurl": "source_url",  # pre-existing gap fixed in worker.js's CSV_COLUMN_ALIASES too
    "matchreq%": "weighted_score",
    "match%": "weighted_score",
    "region/eligibility": "region_eligibility",
    "deadline/nextcohort": "deadline",
    "notes/actions": "notes",
    "eligibility(keyconditions)": "eligibility_conditions",
    "non-dilutive?": "non_dilutive",
    "stackrequired?": "stack_required",
    "weightedscore": "weighted_score",
    # Grants.gov extract fields (fetch_xml_extract.py) / Simpler Grants.gov sync
    "opportunityid": "opportunity_id",
    "opportunitynumber": "opportunity_number",
    "cfdanumbers": "cfda_numbers",
    "eligibleapplicants": "eligible_applicants",
    "awardceiling": "award_ceiling",
    "awardfloor": "award_floor",
    "isforecast": "is_forecast",
    "estimatedpostdate": "estimated_post_date",
    "sourcechannel": "source_channel",
}

D1_DATABASE = "GRANT_MANAGER_DB"
BATCH_SIZE = 50


def _normalize_header(h: str) -> str:
    """Mirrors normalizeHeader() in worker.js: strip BOM/whitespace, lowercase,
    collapse internal whitespace (preserves slashes/dashes/punctuation)."""
    h = str(h or "").lstrip("﻿").strip().lower()
    return re.sub(r"\s+", "", h)


def resolve_header(h: str) -> str:
    norm = _normalize_header(h)
    return CSV_COLUMN_ALIASES.get(norm, norm)


def _escape(value: str) -> str:
    """Escape a string value for SQLite: wrap in single-quotes, escape interior quotes."""
    return "'" + str(value).replace("'", "''") + "'"


def _sql_value(col: str, raw: object) -> str:
    """Coerce a raw CSV string into a SQL literal appropriate for D1_COLUMN_TYPES[col]."""
    kind = D1_COLUMN_TYPES.get(col, "TEXT")
    s = "" if raw is None else str(raw).strip()

    if kind == "REAL":
        if s == "":
            return "NULL"
        try:
            return repr(float(s))
        except ValueError:
            return "NULL"

    if kind == "BOOL":
        low = s.lower()
        if low in ("yes", "true", "1"):
            return "1"
        if low in ("no", "false", "0"):
            return "0"
        return "NULL"

    if kind == "NULLABLE_TEXT":
        return "NULL" if s == "" else _escape(s)

    # TEXT — blank stays '' (matches existing free-text column behavior).
    return _escape(s)


def resolve_columns(df: pd.DataFrame) -> Dict[str, str]:
    """Map each DataFrame column to a resolved D1 column name, keeping only
    columns import_to_d1 is allowed to write (D1_COLUMN_TYPES). Returns
    {source_df_column: resolved_d1_column}."""
    resolved: Dict[str, str] = {}
    for col in df.columns:
        target = resolve_header(col)
        if target in D1_COLUMN_TYPES and target not in resolved.values():
            resolved[col] = target
    return resolved


def build_sql(rows: List[Dict[str, str]], columns: List[str], synced_at: str) -> str:
    """Return a SQL string of upsert statements, batched by BATCH_SIZE.

    Matches on opportunity_id first (Grants.gov's stable ID — the partial unique
    index only covers non-null values, so rows without one never spuriously
    conflict here), falling back to the name UNIQUE constraint. Both branches
    update the same column set, excluding PRESERVED_COLUMNS.
    """
    if not rows:
        return ""

    all_cols = columns + METADATA_COLUMNS
    cols_sql = ", ".join(all_cols)
    # excluded.<col> is only valid for columns present in this INSERT's column
    # list, so the SET clause must be built from exactly all_cols (both conflict
    # branches update every inserted column, including the one that matched).
    set_sql = ", ".join(f"{c}=excluded.{c}" for c in all_cols)

    statements: List[str] = []
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        value_groups = []
        for row in batch:
            vals = [_sql_value(c, row.get(c, "")) for c in columns]
            vals.append(_escape(synced_at))  # last_synced_at
            value_groups.append(f"  ({', '.join(vals)})")
        values_sql = ",\n".join(value_groups)
        statements.append(
            f"INSERT INTO programs ({cols_sql})\n"
            f"VALUES\n{values_sql}\n"
            f"ON CONFLICT(opportunity_id) WHERE opportunity_id IS NOT NULL DO UPDATE SET {set_sql}\n"
            f"ON CONFLICT(name) DO UPDATE SET {set_sql};"
        )

    return "\n\n".join(statements) + "\n"


def load_and_validate(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    df = _normalize_columns(df)  # program_scoring's alias pass (Stack Required?, etc.)

    header_map = resolve_columns(df)
    if "name" not in header_map.values():
        print("ERROR: CSV is missing a 'Name'/'name' column (required to identify each program).")
        print(f"  Found columns: {list(df.columns)}")
        sys.exit(1)

    df = df.rename(columns=header_map)[list(dict.fromkeys(header_map.values()))]

    blank_names = df["name"].str.strip() == ""
    n_blank = int(blank_names.sum())
    if n_blank:
        print(f"WARNING: Skipping {n_blank} row(s) with blank name.")
        df = df[~blank_names]

    if df.empty:
        print("ERROR: No valid rows to import after validation.")
        sys.exit(1)

    return df


def prepare_rows(df: pd.DataFrame) -> List[Dict[str, str]]:
    return [{col: row.get(col, "") for col in df.columns} for _, row in df.iterrows()]


def run_wrangler(sql_file: str, env: str, wrangler: str) -> int:
    cmd = [wrangler, "d1", "execute", D1_DATABASE, "--file", sql_file]
    if env == "local":
        cmd.append("--local")
    print(f"INFO: Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=False)
    return result.returncode


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import a scored programs CSV into Cloudflare D1."
    )
    parser.add_argument("csv", help="Path to the scored programs CSV file.")
    parser.add_argument(
        "--env",
        choices=["local", "remote"],
        default="remote",
        help="Target D1 environment (default: remote).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print generated SQL without executing it.",
    )
    parser.add_argument(
        "--wrangler",
        default="npx wrangler",
        help="Path or command for wrangler CLI (default: npx wrangler).",
    )
    args = parser.parse_args()

    csv_path = args.csv
    if not Path(csv_path).is_file():
        print(f"ERROR: File not found: {csv_path}")
        sys.exit(1)

    print(f"INFO: Loading {csv_path}")
    df = load_and_validate(csv_path)
    columns = list(df.columns)
    rows = prepare_rows(df)

    synced_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(f"INFO: {len(rows)} row(s) ready for import into {D1_DATABASE} ({args.env}); columns: {columns}")

    sql = build_sql(rows, columns, synced_at)

    if args.dry_run:
        print("\n--- DRY RUN SQL (not executed) ---\n")
        print(sql)
        print(f"--- {len(rows)} row(s), {len(sql)} bytes ---")
        return

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".sql", delete=False, encoding="utf-8"
    ) as tmp:
        tmp.write(sql)
        tmp_path = tmp.name

    try:
        wrangler_cmd = args.wrangler.split()
        cmd = wrangler_cmd + ["d1", "execute", D1_DATABASE, "--file", tmp_path]
        if args.env == "local":
            cmd.append("--local")
        print(f"INFO: Running: {' '.join(cmd)}")
        result = subprocess.run(cmd)
        if result.returncode != 0:
            print(f"ERROR: wrangler exited with code {result.returncode}")
            sys.exit(result.returncode)
        print(f"OK: {len(rows)} row(s) imported successfully.")
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    main()
