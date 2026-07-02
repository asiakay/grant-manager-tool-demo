# Developer Guide

This project combines Python tools for grant wrangling with a minimal web UI and Cloudflare worker. This guide helps fullstack and front‑end developers extend the repository.

## Repository overview
- **Python scripts** – `wrangle_grants.py`, `program_scoring.py`, and helpers under `scripts/` handle data normalization and scoring.
- **UI components** – `ui/` contains the React/Vite frontend (`ui/src/`) served by the Cloudflare Worker via the `ASSETS` binding.
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
   - Extend `ui/src/` with new React components. Run `npm run dev` in `ui/` for hot-reload during development.
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
USER_HASHES={"admin":"pbkdf2$600000$<salt_hex>$<key_hex>"}
```
Generate the hash value with Node (no dependencies needed):
```js
const s = crypto.getRandomValues(new Uint8Array(16));
const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('yourpassword'), 'PBKDF2', false, ['deriveBits']);
const d = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: s, iterations: 600000 }, k, 256);
const h = b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('');
console.log('pbkdf2$600000$' + h(s) + '$' + h(d));
```
Legacy SHA-256 hashes (64-char hex) are still accepted and will be auto-upgraded to PBKDF2 on the user's next successful login.

Wrangler loads `.dev.vars` automatically during `wrangler dev`.

### Running the data pipeline

Two acquisition paths feed the same `data/csvs/` directory that `wrangle_grants.py` merges:

- **Keyword search** (`search_grants.py`) — targeted, requires a query, only returns matches.
- **XML Extract** (`fetch_xml_extract.py`) — the full daily Grants.gov catalog (every posted
  *and* forecasted opportunity), no query or API key required. See
  [grants.gov/help/xml-extract](https://www.grants.gov/xml-extract) for the upstream format.
  Downloads `https://www.grants.gov/extract/GrantsDBExtract<YYYYMMDD>v2.zip`, stepping back a
  day at a time (`--max-lookback`, default 5) if today's extract isn't published yet.

```bash
# Acquire — either or both:
python search_grants.py "workforce development" --filter "opportunityStatuses=posted"
python fetch_xml_extract.py --output data/csvs/grants_gov_extract.csv

# Normalize
python scripts/wrangle_grants.py --input data/csvs --out out/master.csv --print-summary

# Score
python program_scoring.py out/master.csv --out out/scored.csv

# Import into D1  (one command runs extract → wrangle → score → import)
make import          # → remote D1 (production)
make import-local    # → local D1 preview (requires: npx wrangler d1 migrations apply GRANT_MANAGER_DB --local)
```

`import_to_d1.py` validates the CSV, resolves human-readable headers to the real snake_case
D1 columns (`Source URL` → `source_url`, `Award Ceiling` → `award_ceiling`, etc. — see
`CSV_COLUMN_ALIASES`), and upserts rows via a chained `ON CONFLICT` — matching on
`opportunity_id` first (Grants.gov's stable ID, when present), falling back to `name` for
manually-curated or legacy rows. This lets XML-extract rows, Simpler Grants.gov API syncs, and
hand-edited CSVs coexist in the same table without duplicating or orphaning each other. Notes,
AI scoring fields (`ai_score`, `ai_summary`, `ai_tier`, `ai_scored_at`), and `pdf_url` are
user-/AI-owned and are never overwritten by a pipeline re-import.

The Grants.gov sync runs automatically once a day via
[`.github/workflows/grants-gov-sync.yml`](../.github/workflows/grants-gov-sync.yml) (cron
`0 7 * * *`), and the in-Worker Simpler Grants.gov API sync (`syncGrantsWithD1`) runs on its
own daily cron (`[triggers]` in `wrangler.toml`, `0 7 * * *`) ahead of the profile-matcher
worker's `0 8 * * *` scoring run.

For a quick sanity check before importing live data:
```bash
python import_to_d1.py out/scored.csv --dry-run   # prints SQL, no execution
```

### Tests
```bash
pytest                    # Python unit tests
cd worker && npm test     # Worker tests
```

For detailed project goals and the summarizer specification, see `PROMPT.md`.

