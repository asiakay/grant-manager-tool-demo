# grant-manager-tool-demo

Utility repository containing `wrangle_grants.py` for merging and normalizing grant CSV/TSV files.
An optional `wrangle_grants_gui.py` provides a minimal Tkinter interface to run the wrangler without the command line.
The GUI now starts with a simple login screen demonstrating "admin" and
"user" roles. The admin account can adjust weighting and deadline fields
while the standard user can only choose files and run the wrangler.

Credentials are supplied via a `USER_HASHES` environment variable containing
SHA-256 password hashes. Example:

```
export USER_HASHES='{"admin":"<sha256 hash>","user":"<sha256 hash>"}'
```

Hashes can be generated with tools such as `sha256sum`:

```
echo -n "adminpass" | sha256sum
```

See [README_wrangle_grants.md](README_wrangle_grants.md) for usage instructions.

## Sample dataset

A tiny dataset is included under `examples/grants_demo` for quick testing. Run
the wrangler against it to see normalization and scoring in action:

```bash
python wrangle_grants.py --input examples/grants_demo --out out/demo.csv --print-summary
```

This command merges the demo files, computes weighted scores, and writes the
result to `out/demo.csv`.

## Search Grants.gov

Use `search_grants.py` to query Grants.gov directly and export results:

```bash
python search_grants.py education --filter opportunityStatuses=posted --output results.tsv --format tsv
```

The script writes a CSV or TSV and prints a summary table with columns such as
**Award max**, **App deadline**, and a quick timeline for each grant.

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

## Beginner installation

If you're new to Python or Node.js, the following steps walk through a fresh
setup of the project:

1. Install [Python 3.9+](https://www.python.org/downloads/) and
   [Node.js](https://nodejs.org/) if they are not already on your machine.
2. Clone the repository and change into the project directory:

   ```bash
   git clone https://github.com/your-org/grant-manager-tool-demo.git
   cd grant-manager-tool-demo
   ```

3. Create and activate a Python virtual environment, then install the
   dependencies:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

4. (Optional) Install Node dependencies for the Worker demo:

   ```bash
   cd worker
   npm install
   ```

After these steps the `wrangle_grants.py` script and the Worker demo can be run
using the commands shown below.

## Python environment

The wrangling scripts require Python 3.9+ with `pandas` and `openpyxl`.
Create and activate a virtual environment, then install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Cloudflare Worker demo

A minimal Cloudflare Worker is provided for quickly publishing a demo endpoint.
A live demo is available at https://grant-demo.qxc.workers.dev/dashboard.
The worker includes a basic login page configured via the `USER_HASHES`
environment variable. Failed login attempts are stored in the `LOGIN_ATTEMPTS`
KV namespace to enforce a five-try, five-minute lockout.
After logging in, the `/dashboard` view renders the
program data schema table, with links to `/schema` (JSON) and `/data` (CSV)
for alternate views. Authenticated requests to `/api/grants` return the grant
rows scored with weights from the user's profile stored in the `USER_PROFILES`
KV namespace. If that binding is missing, the Worker logs a warning and falls
back to an empty profile, and `/api/grants` responds with an explanatory error.

The Worker relies on a D1 database. Run the migration before deploying:

```bash
cd worker
wrangler d1 migrations apply EQORE_DB
```

Store each user's weight profile as JSON in the `USER_PROFILES` KV namespace
to control how grants are scored. If the binding isn't configured, scoring
defaults to zero for all grants.

## Pipeline vs Direct Write

The project supports a queue‑based pipeline and simpler direct writes for
loading and scoring grants. See
[docs/pipeline_vs_direct_write.md](docs/pipeline_vs_direct_write.md) for a
comparison of cost, grant sources, and selection criteria. The guide also
details required configuration variables:

- `USER_HASHES`
- `USER_PROFILES`
- `PDF_BUCKET`
- `PDF_INGEST`
- `SCORE_QUEUE`
- `EQORE_DB`

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
