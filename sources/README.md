# Adding a New State Funding Source

Each source is an isolated file in `sources/` that implements `BaseSource`.
The CSV writer and D1 importer need no changes when a new source is added.

## Steps

1. **Create** `sources/your_source_name.py`:

```python
from sources.base_source import BaseSource, ProgramRecord

class YourSource(BaseSource):
    source_id = "your_source_slug"  # used in scrape_runs.json

    def fetch(self) -> str:
        # Return raw HTML (or JSON string, etc.) for your source page.
        ...

    def parse(self, raw: str) -> list[ProgramRecord]:
        # Return one ProgramRecord per unique program.
        # Deduplicate by name if the page cross-lists programs.
        ...
```

2. **Register** it in `scripts/scrape_sources.py`:

```python
from sources.your_source_name import YourSource

SOURCES = {
    "mass_gov_funding_resources": MassGovFundingSource,
    "your_source_slug": YourSource,        # add this line
}
```

That's it. Run with:

```bash
python scripts/scrape_sources.py --source your_source_slug --out out/your_source.csv
```

## Output contract

`parse()` must return a list of `ProgramRecord` objects. Only `name` and
`source_url` are required; all other fields default to `""`.

The CSV writer maps `ProgramRecord` fields to column headers that
`import_to_d1.py` already knows via its `CSV_COLUMN_ALIASES` table:

| ProgramRecord field | CSV column | D1 column |
|---|---|---|
| `name` | `Name` | `name` |
| `source_url` | `Source URL` | `source_url` |
| `type` | `Type` | `type` |
| `sponsor` | `Sponsor` | `sponsor` |
| `categories` | `Categories` | _(dropped — not in D1 schema)_ |
| `region_eligibility` | `Region / Eligibility` | `region_eligibility` |
| `deadline_next_cohort` | `Deadline / Next Cohort` | `deadline` |
| `cadence` | `Cadence` | `cadence` |
| `benefits` | `Benefits` | `benefits` |
| `eligibility_key_conditions` | `Eligibility (key conditions)` | `eligibility_conditions` |
| `stage` | `Stage` | `stage` |
| `non_dilutive` | `Non-dilutive?` | `non_dilutive` |
| `stack_required` | `Stack Required?` | `stack_required` |
| `source_channel` | `Source Channel` | `source_channel` |

`source_channel` defaults to `"state_program"` — override if your source
warrants a more specific tag.

## Anomaly detection

`scrape_sources.py` tracks row counts in `data/scrape_runs.json`. If a run
returns fewer than 50% of the previous count (and the previous count was > 5),
the script exits non-zero and the CI job fails loudly. Update the baseline by
deleting or editing the entry in `data/scrape_runs.json` when a source
legitimately shrinks.
