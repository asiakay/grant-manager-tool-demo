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

## Contributing tips
- Keep functions small and documented; prefer deterministic parsing over heuristics.
- Run `pytest` and `npm test` after changes.
- Ensure new features interoperate with `wrangle_grants.py` outputs and the existing scoring pipeline.

For detailed project goals and the summarizer specification, see `PROMPT.md`.

