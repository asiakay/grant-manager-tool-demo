# AGENTS.md — Asia’s Automation Crew

This file describes the automation agents, their goals, inputs, outputs, and schedules.

| Agent | Goal | Inputs | Outputs | Schedule |
|-------|------|--------|---------|----------|
| GrantWrangler | Merge raw grant CSV files into a master dataset | `data/csvs/` | `out/master.csv` | Run `make wrangle` when new data arrives |
| ProgramWatcher | Cloudflare worker for simple health checks | HTTP request to `/api/health` | JSON `{status:'ok', agent:'ProgramWatcher'}` | Always on |
| ScoreWorker | Cloudflare worker that doubles a numeric value | POST to `/api/score` with `{value}` | JSON `{score}` | On demand |
| Visualizer | Local web server to explore the master dataset | `out/master.csv` | Interactive web page | Run `make visualize` after data updates |
