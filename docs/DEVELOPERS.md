# Developer Guide

This project combines Python tools for grant wrangling with a minimal web UI and Cloudflare worker. This guide helps fullstack and front‑end developers extend the repository.

## Repository overview
- **Python scripts** – `wrangle_grants.py`, `program_scoring.py`, and helpers under `scripts/` handle data normalization and scoring.
- **UI components** – `ui/` contains React modules such as `ScoringTable.jsx` for rendering results in the browser.
- **Workers** – `worker.js` and files in `workers/` provide a Cloudflare Worker demo for publishing data or prototyping APIs.

## Backend & fullstack development
1. **Environment**
   - Use Python 3.9+.
   - `python3 -m venv .venv && source .venv/bin/activate`
   - `pip install -r requirements.txt`
2. **Data flow**
   - Run `wrangle_grants.py` to merge and normalize grant spreadsheets.
   - The upcoming `grant_summarizer` package will turn PDF RFPs into clean rows that feed `src/make_scoring_template.py` and `src.pipeline` for scoring.
3. **Testing**
   - Add unit tests with `pytest` and run `pytest` before committing changes.
4. **APIs & workers**
   - Cloudflare worker code lives in `worker.js` and `workers/`. Use `npm run dev` for local development and `npm run deploy` to publish.
   - After logging in, the demo dashboard shows a program data schema table and exposes `/schema` (JSON) and `/data` (CSV) for alternative views.

5. **PDF upload workflow**
   - `POST /upload` stores a PDF in an R2 bucket bound as `PDF_BUCKET`. Send a multipart form with a `file` field or JSON `{"name":"file.pdf","data":"<base64>"}`.
   - `GET /pdf/:name` streams the stored PDF back to the client. For example: `curl https://<worker>/pdf/example.pdf --output example.pdf`.

## Front‑end development
1. **Setup**
   - Install Node.js and run `npm install` to fetch dependencies.
   - `npm start` runs the example worker, and `npm test` executes Node tests.
2. **React components**
   - Extend `ui/` with new JSX modules. `ScoringTable.jsx` shows how to load CSVs and render them with simple interactivity.
3. **Integration**
   - Front‑end modules can request data from the Cloudflare worker or consume files produced by the Python pipeline.

## Contributing

This repository is source-available for evaluation purposes, not open-contribution. The IP belongs to its builder.

If you are reviewing this codebase for a partnership, licensing discussion, or technical evaluation: welcome. Reach out via [LinkedIn](https://www.linkedin.com/in/asia-lakay-grady/) before opening pull requests.

Bug reports and security disclosures are welcome via GitHub Issues.

## Local Development

### Prerequisites
- Python 3.9+
- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- A Cloudflare account with Workers, D1, KV, and R2 enabled

### Python environment
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Worker (local dev server)
```bash
cd worker
npm install
npx wrangler dev          # starts local worker at http://localhost:8787
```

The local dev server uses remote D1 by default. To bind a local D1 preview:
```bash
npx wrangler d1 migrations apply GRANT_MANAGER_DB --local
npx wrangler dev --local
```

### Secrets in local dev
Do not put `USER_HASHES` in `wrangler.toml`. For local development, use a `.dev.vars` file (gitignored):
```
USER_HASHES={"admin":"<sha256hex>"}
```
Wrangler loads `.dev.vars` automatically during `wrangler dev`.

### Running the data pipeline
```bash
# Acquire
python search_grants.py "workforce development" --filter "opportunityStatuses=posted"

# Normalize
python wrangle_grants.py --input data/ --out master.csv --print-summary

# Score
python program_scoring.py master.csv --out scored.csv
```

### Tests
```bash
pytest                    # Python unit tests
cd worker && npm test     # Worker tests
```

For detailed project goals and the summarizer specification, see `PROMPT.md`.

