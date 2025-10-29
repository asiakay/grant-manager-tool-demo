# grant-manager-tool-demo

Tools for searching Grants.gov and wrangling grant datasets.

## Quick Start

```bash
python search_grants.py education --filter opportunityStatuses=posted --output results.tsv --format tsv
python wrangle_grants.py --input examples/grants_demo --out out/demo.csv --print-summary
```

`search_grants.py` now queries the Grants.gov API with HTTP GET requests, sending
keywords and filters as query parameters (e.g., `?keywords=education&limit=20`).
If the API responds with a non-200 status, the script logs the error and returns
no results.

See [docs/README.md](docs/README.md) for detailed features and additional documentation.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fasiakay%2Fgrant-manager-tool-demo)
