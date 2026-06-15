#!/usr/bin/env python3
"""Helper to score program/accelerator opportunities.

Adds StackAlignment and CadenceRecency columns and computes
Weighted Score using:
 0.3*Relevance + 0.3*Fit + 0.2*Ease + 0.1*StackAlignment + 0.1*CadenceRecency

CadenceRecency is 1.0 for rolling opportunities, otherwise
normalized by days until the next cohort (within a year).
StackAlignment is 1.0 when the required stack is used, else 0.2.
"""

from __future__ import annotations

import argparse
import datetime
import pandas as pd

# Canonical column names and their accepted aliases (first alias wins on read).
_COLUMN_ALIASES: dict[str, list[str]] = {
    "Stack Required?": ["StackRequired", "Stack Required"],
    "Deadline / Next Cohort": ["DeadlineISO", "Deadline", "Next Cohort"],
    "Cadence": [],
    "Relevance": [],
    "Fit": [],
    "Ease": ["Ease of Use"],
}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Rename aliased column names to their canonical form in-place copy."""
    rename: dict[str, str] = {}
    for canonical, aliases in _COLUMN_ALIASES.items():
        if canonical not in df.columns:
            for alias in aliases:
                if alias in df.columns:
                    rename[alias] = canonical
                    break
    return df.rename(columns=rename)


def _validate_columns(df: pd.DataFrame) -> None:
    """Raise ValueError listing every required column that is absent."""
    missing = [col for col in _COLUMN_ALIASES if col not in df.columns]
    if missing:
        raise ValueError(
            f"program_scoring: input CSV is missing required columns: {missing}.\n"
            f"Found columns: {list(df.columns)}.\n"
            "Expected schema: programs/accelerators CSV, not grants CSV. "
            "Pass a file like data/programs.csv or examples/programs.csv."
        )


def add_program_scores(df: pd.DataFrame) -> pd.DataFrame:
    """Compute stack/cadence scores and Weighted Score for program rows."""
    df = _normalize_columns(df)
    _validate_columns(df)

    today = pd.Timestamp(datetime.date.today())

    stack_align = []
    cadence_recency = []
    scores = []

    for _, row in df.iterrows():
        # Stack alignment: assume "yes" means we already use the required stack
        stack_required = str(row["Stack Required?"]).lower()
        stack_alignment = 1.0 if "yes" in stack_required else 0.2

        # Cadence / recency
        deadline_str = str(row["Deadline / Next Cohort"])
        cadence_str = str(row["Cadence"]).lower()
        if "rolling" in deadline_str.lower() or "rolling" in cadence_str:
            cad_rec = 1.0
        else:
            deadline = pd.to_datetime(deadline_str, errors="coerce")
            if pd.isna(deadline):
                cad_rec = 0.0
            else:
                days = (deadline - today).days
                if days < 0:
                    cad_rec = 0.0
                else:
                    cad_rec = max(0.0, 1 - min(days, 365) / 365)

        # NaN is truthy in Python so `x or 0` does NOT coerce NaN to 0.
        # Use explicit isna() check instead.
        def _num(v: object) -> float:
            x = pd.to_numeric(v, errors="coerce")
            return 0.0 if pd.isna(x) else float(x)

        r = _num(row["Relevance"])
        f = _num(row["Fit"])
        e = _num(row["Ease"])
        score = 0.3 * r + 0.3 * f + 0.2 * e + 0.1 * stack_alignment + 0.1 * cad_rec

        stack_align.append(round(stack_alignment, 3))
        cadence_recency.append(round(cad_rec, 3))
        scores.append(round(score, 3))

    df["StackAlignment"] = stack_align
    df["CadenceRecency"] = cadence_recency
    df["Weighted Score"] = scores
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description="Score program opportunities")
    parser.add_argument("csv", help="Path to programs.csv")
    parser.add_argument("--out", help="Optional output CSV path")
    args = parser.parse_args()

    df = pd.read_csv(args.csv)
    df_scored = add_program_scores(df)

    if args.out:
        df_scored.to_csv(args.out, index=False)
    else:
        print(df_scored)


if __name__ == "__main__":
    main()
