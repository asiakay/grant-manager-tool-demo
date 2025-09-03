# AGENTS.md — Asia’s Automation Crew

This file describes the automation agents, their goals, inputs, outputs, schedules, and source paths.

## Contributing

- Update the table whenever a new agent is added or when an existing agent's goal, inputs, outputs, schedule, or source path changes.
- Keep entries concise: use capitalized agent names, wrap file paths and commands in backticks, and limit each column to a single sentence.
- Run `npm test` before committing to verify repository checks pass.

| Agent | Goal | Inputs | Outputs | Schedule | Source |
|-------|------|--------|---------|----------|--------|
| GrantWrangler | Merge raw grant CSV files into a master dataset | `data/csvs/` | `out/master.csv` | Run `make wrangle` when new data arrives | Implemented in `wrangle_grants.py` |
| ProgramWatcher | Cloudflare worker for simple health checks | HTTP request to `/api/health` | JSON `{status:'ok', agent:'ProgramWatcher'}` | Always on | Implemented in `workers/program_watcher_worker.js` |
| ScoreWorker | Cloudflare worker that doubles a numeric value | POST to `/api/score` with `{value}` | JSON `{score}` | On demand | Implemented in `worker/src/worker.ts` |
| Visualizer | Local web server to explore the master dataset | `out/master.csv` | Interactive web page | Run `make visualize` after data updates | Implemented in `visualize_grants_web.py` |
