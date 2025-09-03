# grant_summarizer

Small CLI that extracts key fields from a grant PDF and writes a clean row and Markdown summaries.

## Installation

```bash
cd grant_summarizer
pip install -e .
```

## Usage

```bash
# Summarize a local PDF
grant-summarizer --pdf path/to/file.pdf --format all --outdir ./dist

# Or summarize directly from a URL (HTML or PDF)
grant-summarizer --url https://example.com/grant.html --format all --outdir ./dist
```

This produces `clean_row.json`, `clean_row.csv`, and Markdown summary files in the output directory.
