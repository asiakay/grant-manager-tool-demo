# AGENTS.md — Asia’s Automation Crew

This file describes the automation agents, their goals, inputs, outputs, run commands, schedules, and source paths.

## Contributing

- Update the table whenever a new agent is added or when an existing agent's goal, inputs, outputs, run command, schedule, or source path changes.
- Keep entries concise: use capitalized agent names, wrap file paths and commands in backticks, and limit each column to a single sentence.
- Run `npm test` before committing to verify repository checks pass.

| Agent | Goal | Inputs | Outputs | Run Command | Schedule | Source |
|-------|------|--------|---------|-------------|----------|--------|
| GrantWrangler | Merge raw grant CSV files into a master dataset | `data/csvs/` | `out/master.csv` | `make wrangle` | On new data arrival | `wrangle_grants.py` |
| ProgramWatcher | Cloudflare worker for simple health checks | HTTP request to `/api/health` | JSON `{status:'ok', agent:'ProgramWatcher'}` | `npx wrangler dev --local` | Always on | `workers/program_watcher_worker.js` |
| ScoreWorker | Cloudflare worker that doubles a numeric value | POST to `/api/score` with `{value}` | JSON `{score}` | `npx wrangler dev --local` | On demand | `worker/src/worker.ts` |
| GrantSearcher | Fetch grants.gov results on a schedule | Cron trigger | `scheduled-search.json` in R2 | `npx wrangler deploy` | Daily at 00:00 | `worker/src/worker.ts` |
| GrantScorer | Serve scored grants for logged-in users | `USER_PROFILES` KV and D1 `programs` table | JSON array of scored grants | `npx wrangler dev --local` | On demand | `worker.js` |
| Visualizer | Local web server to explore the master dataset | `out/master.csv` | Interactive web page | `make visualize` | After data updates | `visualize_grants_web.py` |
| GrantFinder | Query Grants.gov with keywords and filters | CLI args | CSV/TSV file and printed summary | `python search_grants.py education` | On demand | `search_grants.py` |
