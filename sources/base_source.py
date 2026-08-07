"""Base interface every state funding source must implement.

To add a new source:
  1. Subclass BaseSource in a new file under sources/
  2. Implement fetch() and parse()
  3. Register in scripts/scrape_sources.py SOURCES dict

See sources/README.md for the full walkthrough.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

# CSV column headers — matches fetch_xml_extract.py's output so import_to_d1.py
# resolves them via its existing CSV_COLUMN_ALIASES table without any changes.
# "Categories" has no D1 column; import_to_d1.py silently drops unknown columns.
CSV_COLUMNS = [
    "Type",
    "Name",
    "Sponsor",
    "Source URL",
    "Categories",
    "Region / Eligibility",
    "Deadline / Next Cohort",
    "Cadence",
    "Benefits",
    "Eligibility (key conditions)",
    "Stage",
    "Non-dilutive?",
    "Stack Required?",
    "Relevance",
    "Fit",
    "Ease",
    "Source Channel",
]


@dataclass
class ProgramRecord:
    """One row in the output CSV, one program in D1."""

    name: str
    source_url: str
    type: str = ""
    sponsor: str = ""
    categories: str = ""  # comma-joined; used for dedup transparency, dropped by import_to_d1.py
    region_eligibility: str = ""
    deadline_next_cohort: str = ""
    cadence: str = ""
    benefits: str = ""
    eligibility_key_conditions: str = ""
    stage: str = ""
    non_dilutive: str = ""
    stack_required: str = ""
    relevance: str = ""
    fit: str = ""
    ease: str = ""
    source_channel: str = "state_program"

    def to_csv_row(self) -> dict:
        return {
            "Type": self.type,
            "Name": self.name,
            "Sponsor": self.sponsor,
            "Source URL": self.source_url,
            "Categories": self.categories,
            "Region / Eligibility": self.region_eligibility,
            "Deadline / Next Cohort": self.deadline_next_cohort,
            "Cadence": self.cadence,
            "Benefits": self.benefits,
            "Eligibility (key conditions)": self.eligibility_key_conditions,
            "Stage": self.stage,
            "Non-dilutive?": self.non_dilutive,
            "Stack Required?": self.stack_required,
            "Relevance": self.relevance,
            "Fit": self.fit,
            "Ease": self.ease,
            "Source Channel": self.source_channel,
        }


class BaseSource(ABC):
    """Abstract base for all state funding sources."""

    source_id: str  # stable slug used as the key in SOURCES and scrape_runs.json

    @abstractmethod
    def fetch(self) -> str:
        """Return raw HTML/content for this source."""

    @abstractmethod
    def parse(self, raw: str) -> list[ProgramRecord]:
        """Parse raw content into ProgramRecords."""

    def run(self) -> list[ProgramRecord]:
        return self.parse(self.fetch())
