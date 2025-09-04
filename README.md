# grant-manager-tool-demo

Utility repository containing `wrangle_grants.py` for merging and normalizing grant CSV/TSV files.
An optional `wrangle_grants_gui.py` provides a minimal Tkinter interface to run the wrangler without the command line.
The GUI starts with a simple login screen showing "admin" and "user" roles. The admin account can adjust weighting and deadline fields while a standard user can only choose files and run the wrangler.

See [docs/README.md](docs/README.md) for a project narrative and development environment setup instructions.

Credentials are supplied via a `USER_HASHES` environment variable containing SHA-256 password hashes:

```
export USER_HASHES='{"admin":"<sha256 hash>","user":"<sha256 hash>"}'
```

Generate a hash with:

```
echo -n "adminpass" | sha256sum
```

See [README_wrangle_grants.md](README_wrangle_grants.md) for wrangler usage details.

## Quick start

```bash
# 1. Query Grants.gov and save results
python search_grants.py education --filter opportunityStatuses=posted --output grants.csv

# 2. Merge and score the downloaded file
python wrangle_grants.py --input grants.csv --out out/master.csv --print-summary

# 3. View the top 20 ranked rows (header + 20 lines)
head -n 21 out/master.csv
```

The `search_grants.py` script queries Grants.gov and exports a CSV. `wrangle_grants.py`
normalizes the file, computes weighted scores, and sorts grants so the highest
scoring opportunities appear first. The final command inspects the top 20 results.

## Sample dataset

If Grants.gov access is unavailable, a tiny dataset lives under
`examples/grants_demo` for quick testing:

```bash
python wrangle_grants.py --input examples/grants_demo --out out/demo.csv --print-summary
```

This merges the demo files, computes weighted scores, and writes the result to
`out/demo.csv`.

## Browser visualization

For a quick way to explore wrangled data in your browser, run the small Flask
app:

```bash
python visualize_grants_web.py
```
It opens with a minimal login form (`client` / `demo`) before showing the data.
The page includes a dataset selector letting you switch between
`out/master.csv` (default) and `data/programs.csv`. If the chosen CSV is
missing, the app falls back to tiny sample data so the visualization can still
be demoed.

This visualization uses the optional `plotly` package for its charts. Install it
with `pip install plotly` to enable interactive graphs; without it, the app
runs but displays a friendly message instead of charts.

## Cloudflare Worker demo

`worker.js` exposes a login-protected dashboard and `/api/grants` endpoint that scores rows using per-user weight profiles. A live demo runs at <https://grant-demo.qxc.workers.dev/dashboard>.

Before deploying, apply the D1 database migration:

```bash
cd worker
wrangler d1 migrations apply EQORE_DB
```

Store each user's weight profile as JSON in the `USER_PROFILES` KV namespace to control how grants are scored.

## Pipeline vs Direct Write

The project supports a queue‑based pipeline and simpler direct writes for loading and scoring grants. See [docs/pipeline_vs_direct_write.md](docs/pipeline_vs_direct_write.md) for trade-offs and required environment variables.

## Developer guide

For guidelines on extending the backend, Cloudflare worker, or UI, see
[docs/DEVELOPERS.md](docs/DEVELOPERS.md).

## PDF summarizer CLI

A standalone package under `grant_summarizer/` extracts key fields from a grant PDF and writes a clean row plus Markdown summaries.

### Installation

```bash
cd grant_summarizer
pip install -e .
```

### Usage

```bash
grant-summarizer --pdf path/to/TEGL.pdf --format all --outdir ./dist
```

This command generates `clean_row.json`, `clean_row.csv`, `brief.md`, `one_pager.md`, and `slide_bullets.md` under the chosen output directory.

The resulting CSV can feed directly into the scoring pipeline:

```bash
python src/make_scoring_template.py dist/clean_row.csv --outfile data/master_from_pdf.csv
python -m src.pipeline --input data/master_from_pdf.csv
```

See [PROMPT.md](PROMPT.md) for the full developer specification. Node dependencies such as `node_modules/` are ignored; run `npm install` locally rather than committing them.
