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
from datetime import datetime
import pandas as pd


def add_program_scores(df: pd.DataFrame) -> pd.DataFrame:
    """Compute stack/cadence scores and Weighted Score for program rows."""
    today = pd.Timestamp.today().normalize()

    stack_align = []
    cadence_recency = []
    scores = []

    for _, row in df.iterrows():
        # Stack alignment: assume "yes" means we already use the required stack
        stack_required = str(row.get("Stack Required?", "")).lower()
        stack_alignment = 1.0 if "yes" in stack_required else 0.2

        # Cadence / recency
        deadline_str = str(row.get("Deadline / Next Cohort", ""))
        cadence_str = str(row.get("Cadence", "")).lower()
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

        r = pd.to_numeric(row.get("Relevance", 0), errors="coerce") or 0
        f = pd.to_numeric(row.get("Fit", 0), errors="coerce") or 0
        e = pd.to_numeric(row.get("Ease", 0), errors="coerce") or 0
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
