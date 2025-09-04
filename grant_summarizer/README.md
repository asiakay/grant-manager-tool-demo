# grant_summarizer

Small CLI that extracts key fields from a grant PDF and writes a clean row and Markdown summaries. It can also query the grants.gov API for opportunities.

## Installation

```bash
cd grant_summarizer
pip install -e .
```

## Usage

```bash
# Summarize a local PDF
grant-summarizer --pdf path/to/file.pdf --format all --outdir ./dist

# Or summarize a local HTML/PDF file via file:// URL
grant-summarizer --url file:///path/to/grant.html --format all --outdir ./dist

# Fetch a remote URL (requires network and is insecure)
grant-summarizer --url https://example.com/grant.html --allow-online --format all --outdir ./dist

# Search grants.gov for opportunities
grant-summarizer --search water --outdir ./dist

This uses the Grants.gov API's `keyword` parameter.
```

By default the tool operates offline and only accepts local paths or `file://` URLs. Using `--allow-online` enables downloading content from remote hosts, which may expose the system to malicious files or unexpected network traffic. Only use this flag if you trust the source.

This produces `clean_row.json`, `clean_row.csv`, and Markdown summary files in the output directory. When using `--search`, the API results are saved to `search_results.json`.
