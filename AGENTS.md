# AGENTS.md — Grant Data Pipeline

## Pipeline

Search Grants.gov → Wrangle CSVs → PDF upload or manual input → Summarize/extract fields → Import into clean table.

## Mapping to Client Schema

The database uses normalized tables:

- `opportunities`
- `documents`
- `doc_extraction`

Map these tables to the client's requested columns before delivery. Use `docs/data_contract.json` as the canonical reference for column names, types, and descriptions.

## Run Books

- **Fetch opportunities from Grants.gov**

  ```bash
  python search_grants.py "water"
  ```

- **Merge raw CSVs**

  ```bash
  python wrangle_grants.py data/csvs/ out/master.csv
  ```

- **Summarize grant documents**

  ```bash
  grant-summarizer --pdf path/to/file.pdf --format all --outdir ./dist
  ```

## Testing

All code changes must pass:

```bash
npm test
```
