# grant-manager-tool-demo

Tools for searching Grants.gov and wrangling grant datasets.

## Quick Start

```bash
python search_grants.py education --filter opportunityStatuses=posted --output results.tsv --format tsv
python wrangle_grants.py --input examples/grants_demo --out out/demo.csv --print-summary
```

See [docs/README.md](docs/README.md) for detailed features and additional documentation.
