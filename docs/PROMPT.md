# PROMPT.md — Build the TEGL/RFP Extract + Summarize Tool

## Goal

Implement a small, testable CLI that ingests a grant PDF (TEGL/RFP), **extracts the key fields**, and **outputs**:

1. a **clean row** matching our Coda schema (JSON + CSV),
2. a **5-bullet executive brief** and **1-page narrative** (Markdown),
3. **slide bullets** for a deck (Markdown).

Focus on **deterministic parsing first**, then light heuristics. Keep it dependency-light and fast.

---

## Tech & Structure

- Language: **Python 3.10+** (use a dedicated virtualenv for the summarizer to avoid conflicts with the existing pipeline’s environment)
- CLI: **Typer**
- PDF text: **pdfminer.six** (prefer) or **PyPDF2** fallback
- Models/validation: **pydantic**
- Tests: **pytest**

```
/grant_summarizer
  /grant_summarizer
    __init__.py
    cli.py
    extract.py
    normalize.py
    summarize.py
    schema.py
    rules.py
    utils.py
  /tests
    test_extract.py
    test_normalize.py
    test_summarize.py
  pyproject.toml
  README.md
```

---

## Inputs

- `--pdf` path to a local PDF (e.g., “TEGL 02-25.pdf”).
- Optional flags:

  - `--format json|csv|md|all` (default: `all`)
  - `--outdir ./dist`
  - `--debug`

---

## Outputs (write to `--outdir`)

1. **Clean row**

   - `clean_row.json` (single object)
   - `clean_row.csv` (single row)

2. **Summaries**

   - `brief.md` (5 bullets, ≤80 chars per bullet)
   - `one_pager.md` (\~250–400 words, headings + bold key numbers)
   - `slide_bullets.md` (10 bullets, ≤100 chars each)

3. **Logs**

   - `run.log` (debug info if `--debug`)

---

## Target Schema (Coda “clean table”)

Map parsed values to these fields (strings unless noted):

- `Grant name`
- `Sponsor org`
- `Link` _(if found in PDF; else empty)_
- `Award max` _(number or string like “$8,000,000”)_
- `RFP` _(doc title/identifier, e.g., “TEGL 02-25 + Amendment One”)_
- `Innovation/execution` _(short phrase)_
- `Latest preparation start date` _(YYYY-MM-DD if known; else empty)_
- `App deadline` _(YYYY-MM-DD or “Rolling”)_
- `Partners notes` _(comma-sep org types)_
- `Match req %` _(e.g., “0% (leveraging encouraged)”)_
- `Timeline summary` _(e.g., “45 months from Oct 1, 2025...”)_
- `App process` _(short pipeline string)_
- `App package` _(required parts, one line)_
- `Extra notes` _(freeform, compact)_
- `Industries` _(comma-sep list)_
- `Reimb. %`
- `Ceiling` _(per-employee/per-employer ceiling notes)_
- `Milestone split`
- `KPI targets`
- `Reporting schema`

> For TEGL 02-25, e.g., `Reimb. % = "Up to 80%"`, `Industries` include shipbuilding, AI infra, advanced mfg, nuclear, domestic minerals, IT; `Reporting schema` = “Quarterly QPR/QNR via WIPS; Demo PIRL subset”; `Match req % = "0% (leveraging encouraged)"`.

---

## Repo Interop

This repo already contains a funding pipeline and explorer app. Make your summarizer outputs interoperate cleanly:

- The summarizer’s CSV/TSV should match the curated “summary” schema (columns like `Grant name`, `Sponsor org`, `App deadline`, `Award max`, `RFP`, `Innovation/execution`, `Match req %`, etc.).
- To score and export with the pipeline:
  1. Run: `python src/make_scoring_template.py <your_summary.csv> --outfile data/master_from_pdf.csv`
  2. Then: `python -m src.pipeline --input data/master_from_pdf.csv`
- The app (`streamlit run src/app.py`) can directly load enriched/summary files for exploration.

Notes:
- Column compatibility: the pipeline accepts `Grant name`/`Sponsor org`/`App deadline` and normalizes them to `Grant Name`/`Sponsor`/`Deadline`.
- `Match req %` is accepted and normalized to `Match %` for scoring.

## Parsing Rules & Heuristics

Implement **rule-based extraction** with keyword windows + regex, then normalize.

### Core patterns (case-insensitive)

- **Award/Funding**: `award`, `funding`, `available`, `up to`, `range`, `3–8`, `$`
- **Deadline**: `Applications due`, `submit by`, `11:59`, `ET`, `closing date`
- **Eligibility**: `Eligible lead`, `State Workforce Agencies`, `SWA`
- **Industries**: `industries`, `priority`, `shipbuilding`, `AI`, `advanced manufacturing`, `nuclear`, `minerals`, `IT`
- **Timeline/PoP**: `period of performance`, `months`, `planning phase`, `start date`
- **Reimbursement**: `reimburse`, `up to 80%`, `milestones`, `completion`, `6 months`
- **Ceilings**: `per-employee`, `per-employer`, `ceiling`
- **Reporting**: `Quarterly`, `QPR`, `QNR`, `WIPS`, `PIRL`
- **Match/Cost share**: `cost sharing`, `match`, `leveraged`
- **Narrative/Package**: `Project Narrative`, `SF-424`, `Budget Narrative`, `attachments`
- **Amendments/CFDA**: `CFDA`, `17.280` (TEGL 02-25 amendment)

### Regex examples

- Dollar amounts: `r'\$\s?[\d,]+(?:\.\d+)?'`
- Percent: `r'\d{1,3}\s?%'`
- Date (US): `r'(January|February|...|Dec)\s?\d{1,2},\s?\d{4}'` and ISO: `r'\d{4}-\d{2}-\d{2}'`
- Hours: `r'11:59\s?p\.m\.\s?ET'`

### Windowing

When a keyword hits, take ±300 chars around it, then apply regex/cleanup.

### Normalization

- Collapse whitespace, remove duplicate punctuation.
- Standardize currency to `$X,XXX,XXX` form when obvious.
- Convert known phrases (e.g., “no cost sharing required”) to `Match req % = "0% (leveraging encouraged)"`.

---

## Required Functions (implement with docstrings & types)

```python
# schema.py
from pydantic import BaseModel
from typing import Optional

class CleanRow(BaseModel):
    grant_name: str
    sponsor_org: str
    link: Optional[str] = ""
    award_max: Optional[str] = ""
    rfp: Optional[str] = ""
    innovation_execution: Optional[str] = ""
    latest_preparation_start_date: Optional[str] = ""
    app_deadline: Optional[str] = ""
    partners_notes: Optional[str] = ""
    match_req_pct: Optional[str] = ""
    timeline_summary: Optional[str] = ""
    app_process: Optional[str] = ""
    app_package: Optional[str] = ""
    extra_notes: Optional[str] = ""
    industries: Optional[str] = ""
    reimb_pct: Optional[str] = ""
    ceiling: Optional[str] = ""
    milestone_split: Optional[str] = ""
    kpi_targets: Optional[str] = ""
    reporting_schema: Optional[str] = ""
```

```python
# extract.py
def extract_text(pdf_path: str) -> str: ...
def find_field_windows(text: str) -> dict[str, str]: ...
```

```python
# normalize.py
from .schema import CleanRow
def normalize_fields(windows: dict[str, str]) -> CleanRow: ...
```

```python
# summarize.py
def brief_bullets(row: "CleanRow") -> list[str]: ...
def one_pager_md(row: "CleanRow") -> str: ...
def slide_bullets(row: "CleanRow") -> list[str]: ...
```

```python
# cli.py
import typer
def main(pdf: str, format: str = "all", outdir: str = "./dist", debug: bool = False): ...
if __name__ == "__main__":
    typer.run(main)
```

---

## Acceptance Criteria

- `grant_summarizer` installs with `pip -e .` and provides `grant-summarizer` CLI.
- `grant-summarizer --pdf TEGL_02-25.pdf --format all` produces:

  - `dist/clean_row.json` and `dist/clean_row.csv` with correctly mapped fields.
  - `dist/brief.md` (exactly 5 bullets).
  - `dist/one_pager.md` (\~250–400 words, includes Funding, Deadline, Period, Eligibility, Industries, Reimbursement, Reporting).
  - `dist/slide_bullets.md` (10 concise bullets).

- Parser captures TEGL 02-25 specifics:

  - **Funding:** “~$30M; $3–$8M each; ≥$5M shipbuilding”
  - **Deadline:** “September 5, 2025, 11:59 p.m. ET”
  - **PoP:** “45 months from Oct 1, 2025; 60-day planning”
  - **Lead:** “State Workforce Agencies”
  - **Reimb.:** “Up to 80%; 2 milestones (completion + 6-month retention)”
  - **90/10 rule**, **WIPS/QPR/QNR**, **PIRL subset**
  - **CFDA corrected to 17.280**

- Unit tests cover:

  - Money/date/percent regex
  - Window extraction (keyword → window text)
  - Normalization into the `CleanRow` schema
  - Markdown generators shape & constraints

---

## Sample CLI Session (TEGL 02-25)

```
grant-summarizer --pdf "./pdfs/TEGL 02-25.pdf" --format all --outdir ./dist
# Outputs brief.md, one_pager.md, slide_bullets.md, clean_row.json, clean_row.csv
```

---

## Getting Started (Summarizer)

1) Create an isolated environment for the summarizer (Python 3.10+):

```bash
python -m venv .venv-summarizer
source .venv-summarizer/bin/activate
pip install -e .  # inside your grant_summarizer project with pyproject.toml
```

2) Run against a PDF and generate artifacts:

```bash
grant-summarizer --pdf "./pdfs/Some_RFP.pdf" --format all --outdir ./dist
# Produces dist/clean_row.csv (single row) + Markdown summaries
```

3) Feed the CSV into this pipeline (from the repo root of the funding pipeline):

```bash
python src/make_scoring_template.py dist/clean_row.csv --outfile data/master_from_pdf.csv
python -m src.pipeline --input data/master_from_pdf.csv
```

Notes
- The template builder normalizes columns (e.g., `Grant name` → `Grant Name`, `Sponsor org` → `Sponsor`, `App deadline` → `Deadline`) and maps `Match req %` → `Match %` automatically.
- You can concatenate multiple `clean_row.csv` files into a single CSV/TSV before running the template builder if you summarize more than one PDF.

## Notes

- Prefer **deterministic** rules. If ambiguity remains, leave field empty rather than guessing.
- Keep functions small & pure; write tests as you go.
- No external calls; everything runs offline on the PDF content.
