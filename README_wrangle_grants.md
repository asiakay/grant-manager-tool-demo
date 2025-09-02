# CSV → Clean Master Wrangling

This script merges many grant CSV/TSV files into **one clean master** with a consistent schema, normalized deadlines/money, deduplication, and a **Weighted Score** column.

## Quick Start

```bash
# 1) Put all your CSV/TSV files in a folder
mkdir -p data/csvs
# (drop files into data/csvs)

# 2) Run the script (adjust paths as needed)
python wrangle_grants.py --input data/csvs --out out/master.csv --xlsx out/master.xlsx --weights 0.4 0.4 0.2 --deadline-cutoff today --print-summary
```

## GUI Option

For a basic desktop interface instead of the command line, run:

```bash
python wrangle_grants_gui.py
```

The window lets you choose folders and output paths, tweak weights, set a deadline cutoff, and run the wrangler.

## What it does (in plain English)

* Scans a folder of CSV/TSV files → merges into **one clean master**
* Normalizes headers into your **Clean Table** schema
* Parses **money** (Award max/min/Total funding) and **dates** (Deadline)
* Computes **Weighted Score** from Relevance, EQORE Fit, Ease of Use (weights configurable)
* Adds **Days to Deadline** + **Expired** flags
* Deduplicates by **Grant name + Sponsor org**
* Sorts by **Weighted Score (desc)** then **Deadline (asc)**
* Exports **CSV** (and optional **Excel**)

## Notes

* It already recognizes lots of messy header names (e.g., “Opportunity Title,” “Award Ceiling,” “Close Date”).
* If you spot columns it didn’t map, tell me the exact header text and I’ll add them to the alias list so your next run is perfect.
