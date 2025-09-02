#!/usr/bin/env python3
"""
Wrangle many grant CSVs into one clean master.

Usage:
    python wrangle_grants.py --input ./data/csvs --out ./out/master.csv --xlsx ./out/master.xlsx \
        --weights 0.4 0.4 0.2 --deadline-cutoff today

Notes:
- Requires: Python 3.9+, pandas, openpyxl (for .xlsx output).
- No internet access required.
- You can safely run it multiple times; it will re-create outputs.
"""

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, date
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
import logging

try:
    from tqdm import tqdm  # type: ignore
except Exception:  # pragma: no cover - tqdm is optional
    def tqdm(x, **kwargs):
        return x

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def error(msg: str) -> None:
    """Log ``msg`` and abort the program."""
    raise SystemExit(f"ERROR: {msg}")

# -------------------- Configuration --------------------

# Canonical schema
CANON_COLS = [
    "Grant name",
    "Sponsor org",
    "Link",
    "Award max",
    "Award min",
    "Funding instrument",
    "Eligibility",
    "Period of performance",
    "Deadline",
    "Total funding",
    "Relevance",
    "EQORE Fit",
    "Ease of Use",
    "Weighted Score",
    "Status",
    "Notes",
]

# Column alias map: maps lowercase/stripped input headers to canonical column names
ALIASES: Dict[str, str] = {
    # Grant name
    "grant name": "Grant name",
    "opportunity title": "Grant name",
    "title": "Grant name",
    "program name": "Grant name",
    "funding opportunity title": "Grant name",

    # Sponsor org
    "sponsor org": "Sponsor org",
    "agency": "Sponsor org",
    "sponsoring agency": "Sponsor org",
    "organization": "Sponsor org",
    "sponsor": "Sponsor org",
    "department": "Sponsor org",

    # Link
    "link": "Link",
    "url": "Link",
    "opportunity link": "Link",
    "grant link": "Link",
    "program link": "Link",
    "opportunity url": "Link",

    # Award max/min
    "award max": "Award max",
    "maximum award": "Award max",
    "award ceiling": "Award max",
    "ceiling": "Award max",
    "award maximum": "Award max",
    "award min": "Award min",
    "minimum award": "Award min",
    "award floor": "Award min",
    "floor": "Award min",

    # Funding instrument
    "funding instrument": "Funding instrument",
    "instrument": "Funding instrument",
    "funding type": "Funding instrument",

    # Eligibility
    "eligibility": "Eligibility",
    "eligible applicants": "Eligibility",
    "who may apply": "Eligibility",
    "applicant eligibility": "Eligibility",

    # Period of performance
    "period of performance": "Period of performance",
    "project period": "Period of performance",
    "period": "Period of performance",
    "duration": "Period of performance",

    # Deadline
    "deadline": "Deadline",
    "application deadline": "Deadline",
    "close date": "Deadline",
    "closing date": "Deadline",
    "due date": "Deadline",
    "submission deadline": "Deadline",

    # Total funding
    "total funding": "Total funding",
    "estimated total program funding": "Total funding",
    "funding available": "Total funding",

    # Scores
    "relevance": "Relevance",
    "eqore fit": "EQORE Fit",
    "fit": "EQORE Fit",
    "ease of use": "Ease of Use",
    "ease": "Ease of Use",

    # Status/Notes
    "status": "Status",
    "notes": "Notes",
    "extra notes": "Notes",
    "special notes": "Notes",
}


MONEY_COLS = {"Award max", "Award min", "Total funding"}


def norm_header(h: str) -> str:
    return re.sub(r"\s+", " ", h.strip().lower())


def map_columns(df: pd.DataFrame) -> pd.DataFrame:
    mapped = {}
    for col in df.columns:
        key = norm_header(str(col))
        mapped[col] = ALIASES.get(key, col)  # keep original if unknown
    df = df.rename(columns=mapped)

    # Only keep columns that overlap canonical OR are clearly useful
    keep_cols = set(CANON_COLS) & set(df.columns)
    # Always keep any unexpected columns under Notes (later we can merge text)
    extras = [c for c in df.columns if c not in CANON_COLS]

    # If we have extras, we will concatenate them into Notes
    notes_parts = []
    for c in extras:
        # skip entirely empty columns
        if df[c].notna().any():
            notes_parts.append(f"{c}: " + df[c].astype(str))

    out = pd.DataFrame()
    for c in CANON_COLS:
        if c in keep_cols:
            out[c] = df[c]
        else:
            out[c] = pd.NA

    if notes_parts:
        notes_series = notes_parts[0]
        for s in notes_parts[1:]:
            notes_series = notes_series.fillna("") + " | " + s.fillna("")
        out["Notes"] = out["Notes"].fillna("") + " | " + notes_series.fillna("")
        out["Notes"] = out["Notes"].str.strip(" |")

    return out


def parse_money(x) -> Optional[float]:
    if pd.isna(x):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x)
    s = s.replace(",", "")
    m = re.search(r"(-?\d+(\.\d+)?)", s)
    if not m:
        return None
    try:
        return float(m.group(1))
    except Exception:
        return None


def normalize_money(df: pd.DataFrame) -> pd.DataFrame:
    for c in MONEY_COLS:
        if c in df.columns:
            df[c] = df[c].apply(parse_money)
    return df


def normalize_deadline(df: pd.DataFrame) -> pd.DataFrame:
    if "Deadline" not in df.columns:
        return df
    df["Deadline"] = pd.to_datetime(df["Deadline"], errors="coerce", infer_datetime_format=True, utc=True)
    # keep as date (no time)
    df["Deadline"] = df["Deadline"].dt.tz_convert(None)
    return df


def compute_weighted(df: pd.DataFrame, w_relevance: float, w_fit: float, w_ease: float) -> pd.DataFrame:
    for col in ["Relevance", "EQORE Fit", "Ease of Use"]:
        if col not in df.columns:
            df[col] = pd.NA
        df[col] = pd.to_numeric(df[col], errors="coerce").clip(lower=0, upper=5)

    total = w_relevance + w_fit + w_ease
    if total == 0:
        total = 1.0
    wr = w_relevance / total
    wf = w_fit / total
    we = w_ease / total

    df["Weighted Score"] = (df["Relevance"] * wr + df["EQORE Fit"] * wf + df["Ease of Use"] * we).round(3)
    return df


def add_deadline_helpers(df: pd.DataFrame) -> pd.DataFrame:
    if "Deadline" not in df.columns:
        return df
    today = pd.Timestamp.today().normalize()
    df["Days to Deadline"] = (df["Deadline"] - today).dt.days
    df["Expired"] = df["Days to Deadline"].apply(lambda d: bool(d is not None and pd.notna(d) and d < 0))
    return df


def deduplicate(df: pd.DataFrame) -> pd.DataFrame:
    # Simple key: Grant name + Sponsor org (case-insensitive)
    key_cols = []
    for c in ["Grant name", "Sponsor org"]:
        if c not in df.columns:
            df[c] = pd.NA
        key_cols.append(c)

    key_series = (
        df["Grant name"].astype(str).str.strip().str.lower().fillna("")
        + " | "
        + df["Sponsor org"].astype(str).str.strip().str.lower().fillna("")
    )
    # Keep the first occurrence (prefer non-null rows by sorting)
    sort_cols = []
    if "Deadline" in df.columns:
        sort_cols.append(("Deadline", True))
    if "Weighted Score" in df.columns:
        sort_cols.append(("Weighted Score", False))

    if sort_cols:
        by = [c for c, _ in sort_cols]
        ascending = [asc for _, asc in sort_cols]
        df = df.sort_values(by=by, ascending=ascending, na_position="last")

    # Drop duplicates based on the key
    df["_key"] = key_series
    df = df.drop_duplicates(subset=["_key"], keep="first").drop(columns=["_key"])
    return df


def filter_deadlines(df: pd.DataFrame, cutoff: Optional[str]) -> pd.DataFrame:
    if not cutoff or "Deadline" not in df.columns:
        return df

    today = pd.Timestamp.today().normalize()

    if cutoff.lower() == "today":
        return df[df["Deadline"].isna() | (df["Deadline"] >= today)]

    try:
        dt = pd.to_datetime(cutoff, errors="coerce")
        if pd.isna(dt):
            return df
        dt = pd.Timestamp(dt.date())
        return df[df["Deadline"].isna() | (df["Deadline"] >= dt)]
    except Exception:
        return df


def read_csv_safe(path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(path)
    except Exception:
        # Try TSV
        try:
            return pd.read_csv(path, sep="\t")
        except Exception:
            error(f"Could not read file: {path}")


def load_folder(folder: Path) -> List[pd.DataFrame]:
    frames: List[pd.DataFrame] = []
    for p in tqdm(folder.rglob("*"), desc="Loading files"):
        if p.suffix.lower() in {".csv", ".tsv", ".tab"}:
            df = read_csv_safe(p)
            rows = len(df) if df is not None else 0
            logger.info("Loaded %s (%d rows)", p, rows)
            if df is not None and rows:
            if len(df):
 main
                df["_source_file"] = str(p)
                frames.append(df)
    return frames


def ensure_columns(df: pd.DataFrame) -> pd.DataFrame:
    for c in CANON_COLS:
        if c not in df.columns:
            df[c] = pd.NA
    return df[CANON_COLS + [c for c in df.columns if c not in CANON_COLS]]


def 

(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--input",
        type=str,
        default="",
        help="Folder containing .csv/.tsv files (default: data/csvs)",
    )
    ap.add_argument(
        "--out",
        type=str,
        default="",
        help="Output master CSV path (default: out/master.csv)",
    )
    ap.add_argument("--xlsx", type=str, default="", help="Optional Excel output path")
    ap.add_argument("--weights", type=float, nargs=3, default=[0.4, 0.4, 0.2], help="Weights: relevance fit ease")
    ap.add_argument("--deadline-cutoff", type=str, default="", help="Keep items with Deadline >= this date (YYYY-MM-DD) or 'today'")
    ap.add_argument("--print-summary", action="store_true", help="Print a quick summary to stdout")
    ap.add_argument("--verbose", action="store_true", help="Show debug logging")
    args = ap.parse_args(argv)

    default_in = Path("data/csvs")
    default_out = Path("out/master.csv")

    in_str = args.input.strip()
    if not in_str:
        in_str = input(f"Input folder [{default_in}]: ").strip()
    if not in_str:
        in_str = str(default_in)

    out_str = args.out.strip()
    if not out_str:
        out_str = input(f"Output master CSV path [{default_out}]: ").strip()
    if not out_str:
        out_str = str(default_out)

    in_folder = Path(in_str)
    out_csv = Path(out_str)
    out_xlsx = Path(args.xlsx) if args.xlsx else None

    if in_folder == default_in and not in_folder.exists():
        in_folder.mkdir(parents=True, exist_ok=True)
        print(f"Created default input folder at {in_folder.resolve()}")

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    if out_xlsx:
        out_xlsx.parent.mkdir(parents=True, exist_ok=True)

    if args.verbose:
        logger.setLevel(logging.DEBUG)
    else:
        logger.setLevel(logging.INFO)

    frames = load_folder(in_folder)
    if not frames:
        error(f"No CSV/TSV files found in {in_folder}")

    # Map each to canonical, then concat
    mapped_frames = []
    for df in tqdm(frames, desc="Mapping columns"):
        src = df["_source_file"].iloc[0] if "_source_file" in df.columns else "<unknown>"
        logger.info("Mapping %s (%d rows)", src, len(df))
        m = map_columns(df)
        mapped_frames.append(m)

    all_df = pd.concat(mapped_frames, ignore_index=True)

    # Normalize values
    all_df = normalize_money(all_df)
    all_df = normalize_deadline(all_df)

    # Compute weights
    w_rel, w_fit, w_ease = args.weights
    all_df = compute_weighted(all_df, w_rel, w_fit, w_ease)

    # Helpers
    all_df = add_deadline_helpers(all_df)
    all_df = deduplicate(all_df)
    all_df = filter_deadlines(all_df, args.deadline_cutoff)

    # Ensure canonical columns are present and ordered
    all_df = ensure_columns(all_df)

    # Sort by Weighted Score desc, then Deadline asc
    sort_cols = []
    if "Weighted Score" in all_df.columns:
        sort_cols.append(("Weighted Score", False))
    if "Deadline" in all_df.columns:
        sort_cols.append(("Deadline", True))

    if sort_cols:
        by = [c for c, _ in sort_cols]
        ascending = [asc for _, asc in sort_cols]
        all_df = all_df.sort_values(by=by, ascending=ascending, na_position="last")

    # Write outputs
    all_df.to_csv(out_csv, index=False)
    if out_xlsx:
        try:
            all_df.to_excel(out_xlsx, index=False)
        except Exception as e:
            print(f"WARNING: Could not write Excel file: {e}")

    if args.print_summary:
        total = len(all_df)
        n_expired = int(all_df.get("Expired", pd.Series([False]*total)).sum())
        top5 = all_df.head(5)[["Grant name", "Sponsor org", "Deadline", "Weighted Score"]]
        print(f"Rows: {total} | Expired: {n_expired}")
        try:
            print(top5.to_string(index=False))
        except Exception:
            pass


if __name__ == "__main__":
    main()
