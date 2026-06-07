#!/usr/bin/env python3
"""import_to_d1.py — Load a scored programs CSV into the Cloudflare D1 programs table.

Usage:
  python import_to_d1.py scored.csv
  python import_to_d1.py scored.csv --env local
  python import_to_d1.py scored.csv --dry-run
  python import_to_d1.py scored.csv --env remote --wrangler /path/to/wrangler

The script:
  1. Reads the CSV and normalises column name aliases.
  2. Validates that the Name primary-key column is present.
  3. Drops columns not in the D1 schema (e.g. StackAlignment, CadenceRecency).
  4. Generates idempotent INSERT OR REPLACE SQL in batches of 50.
  5. Executes via `wrangler d1 execute` (or prints SQL with --dry-run).
  6. Never overwrites the "Notes / Actions" column — that column is user-owned
     in D1 and is excluded from the upsert.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List

import pandas as pd

# Import column normalisation from program_scoring to avoid duplication.
from program_scoring import _normalize_columns

# Canonical D1 column order, matching migrations/0001_create_programs.sql.
# "Notes / Actions" is intentionally excluded — it is user-owned in D1 and
# must not be overwritten by a pipeline re-import.
D1_COLUMNS: List[str] = [
    "Type",
    "Name",
    "Sponsor",
    "Source URL",
    "Region / Eligibility",
    "Deadline / Next Cohort",
    "Cadence",
    "Benefits",
    "Eligibility (key conditions)",
    "Stage",
    "Non-dilutive?",
    "Stack Required?",
    "Relevance",
    "Fit",
    "Ease",
    "Weighted Score",
]

D1_DATABASE = "GRANT_MANAGER_DB"
BATCH_SIZE = 50


def _escape(value: str) -> str:
    """Escape a string value for SQLite: wrap in single-quotes, escape interior quotes."""
    return "'" + str(value).replace("'", "''") + "'"


def build_sql(rows: List[dict]) -> str:
    """Return a SQL string of INSERT OR REPLACE statements, batched by BATCH_SIZE."""
    if not rows:
        return ""

    cols_sql = ", ".join(f'"{c}"' for c in D1_COLUMNS)
    statements: List[str] = []

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        value_groups = []
        for row in batch:
            vals = ", ".join(_escape(row.get(c, "")) for c in D1_COLUMNS)
            value_groups.append(f"  ({vals})")
        values_sql = ",\n".join(value_groups)
        statements.append(
            f"INSERT OR REPLACE INTO programs ({cols_sql})\nVALUES\n{values_sql};"
        )

    return "\n\n".join(statements) + "\n"


def load_and_validate(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    df = _normalize_columns(df)

    if "Name" not in df.columns:
        print("ERROR: CSV is missing the 'Name' column (required as D1 primary key).")
        print(f"  Found columns: {list(df.columns)}")
        sys.exit(1)

    blank_names = df["Name"].str.strip() == ""
    n_blank = blank_names.sum()
    if n_blank:
        print(f"WARNING: Skipping {n_blank} row(s) with blank Name.")
        df = df[~blank_names]

    if df.empty:
        print("ERROR: No valid rows to import after validation.")
        sys.exit(1)

    return df


def prepare_rows(df: pd.DataFrame) -> List[dict]:
    """Project df to D1 columns, filling missing columns with empty string."""
    rows = []
    for _, row in df.iterrows():
        rows.append({col: row.get(col, "") for col in D1_COLUMNS})
    return rows


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
    rows = prepare_rows(df)

    dropped = [c for c in df.columns if c not in D1_COLUMNS and c != "Notes / Actions"]
    if dropped:
        print(f"INFO: Dropping {len(dropped)} non-schema column(s): {dropped}")

    print(f"INFO: {len(rows)} row(s) ready for import into {D1_DATABASE} ({args.env})")

    sql = build_sql(rows)

    if args.dry_run:
        print("\n--- DRY RUN SQL (not executed) ---\n")
        print(sql)
        print(f"--- {len(rows)} row(s), {len(sql)} bytes ---")
        return

    # Write SQL to a temp file and execute via wrangler
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".sql", delete=False, encoding="utf-8"
    ) as tmp:
        tmp.write(sql)
        tmp_path = tmp.name

    try:
        # wrangler may be "npx wrangler" (two tokens) — split for subprocess
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
