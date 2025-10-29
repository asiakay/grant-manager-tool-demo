# Grant Manager Tool Demo Documentation

## Repository Narrative
This repository demonstrates a complete workflow for collecting, processing, and presenting grant opportunities.

- **Data wrangling and scoring** – `wrangle_grants.py` consolidates raw CSV/TSV files, normalizes values, and computes weighted scores.
- **Command-line tools** – `search_grants.py` queries the Grants.gov API and enriches results.
- **Graphical interface** – `wrangle_grants_gui.py` wraps the wrangler in a Tkinter app with admin and user roles.
- **Browser visualization** – `visualize_grants_web.py` serves wrangled data through a small Flask app with a credential check.
- **Cloudflare Worker demo** – `worker.js` authenticates users, serves scored grants, and tracks lockouts.
- **PDF summarization** – The `grant_summarizer` package extracts key fields from PDFs or HTML and creates Markdown summaries.
- **Supporting documentation** – The repository includes a root README and additional guides under `docs/`.

## Development Environment Setup
1. Install [Python 3.9+](https://www.python.org/downloads/) and [Node.js](https://nodejs.org/).
2. Clone the repository and enter the project directory:
   ```bash
   git clone https://github.com/your-org/grant-manager-tool-demo.git
   cd grant-manager-tool-demo
   ```
3. Create and activate a Python virtual environment, then install the dependencies:

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

## Python Environment

The wrangling scripts require Python 3.9+ with `pandas` and `openpyxl`. Create and activate a virtual environment, then install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Cloudflare Worker Demo

A minimal Cloudflare Worker publishes a demo endpoint with a basic login page configured via the `USER_HASHES` environment variable. Failed login attempts are stored in the `LOGIN_ATTEMPTS` KV namespace to enforce a five-try, five-minute lockout. After logging in, the `/dashboard` view renders the program data schema table with links to `/schema` (JSON) and `/data` (CSV). Authenticated requests to `/api/grants` return grant rows scored with weights from the user's profile stored in the `USER_PROFILES` KV namespace. If that binding is missing, the Worker logs a warning and falls back to an empty profile, and `/api/grants` responds with an explanatory error.

The Worker relies on a D1 database. Run the migration before deploying:

```bash
cd worker
wrangler d1 migrations apply EQORE_DB
```

Store each user's weight profile as JSON in the `USER_PROFILES` KV namespace to control how grants are scored. If the binding isn't configured, scoring defaults to zero for all grants.

## Pipeline vs Direct Write

The project supports a queue‑based pipeline and simpler direct writes for loading and scoring grants. See [pipeline_vs_direct_write.md](pipeline_vs_direct_write.md) for a comparison of cost, grant sources, and selection criteria.

## PDF Summarizer CLI

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

This command generates `clean_row.json`, `clean_row.csv`, `brief.md`, `one_pager.md`, and `slide_bullets.md` under the chosen output directory. The resulting CSV can feed directly into the scoring pipeline:

```bash
python src/make_scoring_template.py dist/clean_row.csv --outfile data/master_from_pdf.csv
python -m src.pipeline --input data/master_from_pdf.csv
```

## Developer Guide

For guidelines on extending the backend, Cloudflare Worker, or UI, see [DEVELOPERS.md](DEVELOPERS.md).
