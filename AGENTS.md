# AGENTS.md — Asia’s Automation Crew

This file describes the automation agents, their goals, inputs, outputs, run commands, schedules, and source paths.

## Contributing

- Update the table whenever a new agent is added or when an existing agent's goal, inputs, outputs, run command, schedule, or source path changes.
- Keep entries concise: use capitalized agent names, wrap file paths and commands in backticks, and limit each column to a single sentence.
- Run `npm test` before committing to verify repository checks pass.

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


| Agent          | Goal                                            | Inputs                                     | Outputs                                      | Run Command                         | Schedule            | Source                              |
| -------------- | ----------------------------------------------- | ------------------------------------------ | -------------------------------------------- | ----------------------------------- | ------------------- | ----------------------------------- |
| GrantWrangler  | Merge raw grant CSV files into a master dataset | `data/csvs/`                               | `out/master.csv`                             | `make wrangle`                      | On new data arrival | `wrangle_grants.py`                 |
| ProgramWatcher | Cloudflare worker for simple health checks      | HTTP request to `/api/health`              | JSON `{status:'ok', agent:'ProgramWatcher'}` | `npx wrangler dev --local`          | Always on           | `workers/program_watcher_worker.js` |
| ScoreWorker    | Cloudflare worker that doubles a numeric value  | POST to `/api/score` with `{value}`        | JSON `{score}`                               | `npx wrangler dev --local`          | On demand           | `worker/src/worker.ts`              |
| GrantScorer    | Serve scored grants for logged-in users         | `USER_PROFILES` KV and D1 `programs` table | JSON array of scored grants                  | `npx wrangler dev --local`          | On demand           | `worker.js`                         |
| Visualizer     | Local web server to explore the master dataset  | `out/master.csv`                           | Interactive web page                         | `make visualize`                    | After data updates  | `visualize_grants_web.py`           |
| GrantFinder    | Query Grants.gov with keywords and filters      | CLI args                                   | CSV/TSV file and printed summary             | `python search_grants.py education` | On demand           | `search_grants.py`                  |
| WrangleAPI     | Serve wrangled grants via HTTP                  | `data/csvs/`                               | JSON master dataset                          | `python wrangle_api.py`             | On demand           | `wrangle_api.py` |

# AGENTS.md (for `ui/` components)

## Refresh Scores Button

- **Goal**: After a user logs in, clicking “Refresh Scores” wrangles the latest grant data and re-renders the scoring table.
- **Implementation**

  1. Place a new `<Button>` in `ui/ScoringTable.jsx`. This file already imports Material UI’s button component and uses similar buttons inside the detail drawer for actions like “Mark as Candidate”​:codex-file-citation[codex-file-citation]{line_range_start=5 line_range_end=null path=ui/ScoringTable.jsx git_url="https://github.com/asiakay/grant-manager-tool-demo/blob/main/ui/ScoringTable.jsx#L5-Lnull"}​​:codex-file-citation[codex-file-citation]{line_range_start=122 line_range_end=134 path=ui/ScoringTable.jsx git_url="https://github.com/asiakay/grant-manager-tool-demo/blob/main/ui/ScoringTable.jsx#L122-L134"}​
  2. On click, call `fetch('/api/grants')` to retrieve scored grants from the Worker. The `/api/grants` endpoint computes scores using the logged-in user’s profile and returns rows sorted by score​:codex-file-citation[codex-file-citation]{line_range_start=168 line_range_end=199 path=worker.js git_url="https://github.com/asiakay/grant-manager-tool-demo/blob/main/worker.js#L168-L199"}​
  3. Ensure the wrangling step has run (`make wrangle`) so `wrangle_grants.py` merges raw CSVs into a clean dataset before fetching scores​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=7 path=wrangle_grants.py git_url="https://github.com/asiakay/grant-manager-tool-demo/blob/main/wrangle_grants.py#L1-L7"}​
  4. Update local state with the returned data and pass the rows to `ScoringTable` to render the cleaned, scored table.

- **Testing**
  - `make wrangle` – produces `out/master.csv` for the Worker to serve.
  - `npm test` – required before committing, per the repository’s root AGENTS guidelines​:codex-file-citation[codex-file-citation]{line_range_start=5 line_range_end=9 path=AGENTS.md git_url="https://github.com/asiakay/grant-manager-tool-demo/blob/main/AGENTS.md#L5-L9"}​
