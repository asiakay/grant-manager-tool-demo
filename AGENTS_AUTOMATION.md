# AGENTS.md — Asia’s Automation Crew

This file describes the automation agents, their goals, inputs, outputs, run commands, schedules, and source paths.

## Contributing

- Update the table whenever a new agent is added or when an existing agent's goal, inputs, outputs, run command, schedule, or source path changes.
- Keep entries concise: use capitalized agent names, wrap file paths and commands in backticks, and limit each column to a single sentence.
- Run `npm test` before committing to verify repository checks pass.
- `docs/data_contract.json` is the canonical reference for the D1 table schema and field definitions. Update the contract and this file together whenever schemas or scoring rules change.

## Deployment Order

Follow this sequence to set up the system end to end:

1. **Apply D1 migrations**
   ```bash
   wrangler d1 migrations apply
   ```
2. **Deploy `/upload` endpoint**
   ```bash
   npm run build
   wrangler deploy
   ```
3. **Run the extraction queue worker**
   ```bash
   wrangler queues consume PDF_INGEST src/pdf_worker.ts
   ```
4. **Scoring**
   - Run your scoring pipeline after extraction completes.

Run `npm test` before committing to verify repository checks pass.

| Agent          | Goal                                            | Inputs                                     | Outputs                               | Run Command                         | Schedule            | Source |
| -------------- | ----------------------------------------------- | ------------------------------------------ | -------------------------------------- | ----------------------------------- | ------------------- | ----------------------------------- |
| GrantWrangler  | Merge raw grant CSV files into a master dataset | `data/csvs/`                               | `out/master.csv`                       | `make wrangle`                      | On new data arrival | `wrangle_grants.py` |
| ProgramWatcher | Cloudflare worker for simple health checks      | HTTP request to `/api/health`              | JSON `{status:'ok', agent:'ProgramWatcher'}` | `npx wrangler dev --local`          | Always on           | `workers/program_watcher_worker.js` |
| ScoreWorker    | Cloudflare worker that doubles a numeric value  | POST to `/api/score` with `{value}`        | JSON `{score}`                         | `npx wrangler dev --local`          | On demand           | `worker/src/worker.ts` |
| GrantScorer    | Serve scored grants for logged-in users         | `USER_PROFILES` KV and D1 `programs` table | JSON array of scored grants            | `npx wrangler dev --local`          | On demand           | `worker.js` |
| Visualizer     | Local web server to explore the master dataset  | `out/master.csv`                           | Interactive web page                   | `make visualize`                    | After data updates  | `visualize_grants_web.py` |
| GrantFinder    | Query Grants.gov with keywords and filters      | CLI args                                   | CSV/TSV file and printed summary       | `python search_grants.py education` | On demand           | `search_grants.py` |
| WrangleAPI     | Serve wrangled grants via HTTP                  | `data/csvs/`                               | JSON master dataset                    | `python wrangle_api.py`             | On demand           | `wrangle_api.py` |
| UploadWorker   | Store uploaded PDFs in R2 for downstream extraction | POST to `/upload` with file or `{name,data}` | PDF object in `PDF_BUCKET`             | `npx wrangler dev --local`          | On demand           | `worker/src/worker.ts` |
| ExtractionWorker | Convert PDFs to summaries via grant_summarizer | Queue message `{key}` from `PDF_INGEST`    | CSV and Markdown files in `PDF_BUCKET` | `npx wrangler dev src/pdf_worker.ts --local` | On `PDF_INGEST` message | `worker/src/pdf_worker.ts` |
| ScoringWorker  | Score extracted rows and persist results        | Queue message `{file}` from `SCORE_QUEUE`  | Scored CSV in `PDF_BUCKET`             | `npx wrangler dev src/score_worker.ts --local` | On `SCORE_QUEUE` message | `worker/src/score_worker.ts` |

# AGENTS.md (for `ui/` components)

## Refresh Scores Button

- **Goal**: After a user logs in, clicking “Refresh Scores” wrangles the latest grant data and re-renders the scoring table.
- **Implementation**

  1. Place a new `<Button>` in `ui/ScoringTable.jsx`. This file already imports Material UI’s button component and uses similar buttons inside the detail drawer for actions like “Mark as Candidate”.
  2. On click, call `fetch('/api/grants')` to retrieve scored grants from the Worker. The `/api/grants` endpoint computes scores using the logged-in user’s profile and returns rows sorted by score.
  3. Ensure the wrangling step has run (`make wrangle`) so `wrangle_grants.py` merges raw CSVs into a clean dataset before fetching scores.
  4. Update local state with the returned data and pass the rows to `ScoringTable` to render the cleaned, scored table.

- **Testing**
  - `make wrangle` – produces `out/master.csv` for the Worker to serve.
  - `npm test` – required before committing, per the repository’s root AGENTS guidelines.
