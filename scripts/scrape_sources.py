#!/usr/bin/env python3
"""scrape_sources.py — Run one or all state funding source scrapers and write a CSV.

Usage:
  python scripts/scrape_sources.py --source mass_gov_funding_resources --out out/mass_gov.csv
  python scripts/scrape_sources.py --all --out out/all_state_sources.csv
  python scripts/scrape_sources.py --all --out out/all_state_sources.csv --dry-run

The output CSV uses the same column headers as fetch_xml_extract.py, so it flows
directly into import_to_d1.py without renaming:

  python import_to_d1.py out/all_state_sources.csv --env remote

To add a new source: create sources/<name>.py implementing BaseSource, then add
one entry to SOURCES below. See sources/README.md.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Resolve imports whether run from the repo root or via `python scripts/…`
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from sources.base_source import CSV_COLUMNS, ProgramRecord
from sources.mass_gov_funding import MassGovFundingSource

# Registry: source_id → class. Add one line here to register a new source.
SOURCES: dict[str, type] = {
    "mass_gov_funding_resources": MassGovFundingSource,
}

RUNS_LOG_DEFAULT = _REPO_ROOT / "data" / "scrape_runs.json"
# Fail if current count drops below this fraction of the last known count.
ANOMALY_THRESHOLD = 0.5
# Ignore anomaly check when previous count was this small (new sources / small lists).
ANOMALY_MIN_BASELINE = 5


def load_runs_log(path: Path) -> dict:
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def save_runs_log(path: Path, log: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8")


def check_anomaly(source_id: str, count: int, log: dict) -> None:
    """Exit non-zero if count is anomalously low vs. last run."""
    entry = log.get(source_id, {})
    last_count = entry.get("row_count", 0)
    if last_count > ANOMALY_MIN_BASELINE and count < last_count * ANOMALY_THRESHOLD:
        print(
            f"ERROR [{source_id}]: Got {count} rows but last run returned {last_count}. "
            f"This is below the {int(ANOMALY_THRESHOLD*100)}% threshold — possible "
            f"scrape failure. Fix the source or update data/scrape_runs.json to proceed.",
            file=sys.stderr,
        )
        sys.exit(1)


def run_source(source_id: str, cls: type, log: dict, dry_run: bool) -> list[ProgramRecord]:
    print(f"INFO [{source_id}]: fetching...")
    instance = cls()
    try:
        records = instance.run()
    except Exception as exc:
        print(f"ERROR [{source_id}]: {exc}", file=sys.stderr)
        sys.exit(1)

    count = len(records)
    print(f"INFO [{source_id}]: {count} unique program(s) parsed.")

    if count == 0:
        print(
            f"ERROR [{source_id}]: source returned 0 records — possible parse failure.",
            file=sys.stderr,
        )
        sys.exit(1)

    check_anomaly(source_id, count, log)

    if not dry_run:
        log[source_id] = {
            "last_run": datetime.now(timezone.utc).isoformat(),
            "row_count": count,
        }

    return records


def write_csv(records: list[ProgramRecord], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for rec in records:
            writer.writerow(rec.to_csv_row())
    print(f"OK: wrote {len(records)} row(s) to {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run state funding source scrapers.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--source", choices=list(SOURCES.keys()), help="Run a single source.")
    group.add_argument("--all", action="store_true", help="Run all registered sources.")
    parser.add_argument("--out", required=True, help="Output CSV path.")
    parser.add_argument(
        "--runs-log",
        default=str(RUNS_LOG_DEFAULT),
        help=f"Path to scrape run log JSON (default: {RUNS_LOG_DEFAULT}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and print summary but do not write files.",
    )
    args = parser.parse_args()

    log_path = Path(args.runs_log)
    log = load_runs_log(log_path)

    if args.all:
        to_run = list(SOURCES.items())
    else:
        to_run = [(args.source, SOURCES[args.source])]

    all_records: list[ProgramRecord] = []
    for source_id, cls in to_run:
        records = run_source(source_id, cls, log, args.dry_run)
        all_records.extend(records)

    if args.dry_run:
        print(f"DRY RUN: {len(all_records)} total record(s) — no files written.")
        return

    write_csv(all_records, Path(args.out))
    save_runs_log(log_path, log)


if __name__ == "__main__":
    main()
