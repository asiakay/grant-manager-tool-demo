"""Scraper for https://www.mass.gov/lists/funding-resources.

The page lists Massachusetts state funding programs organized under <h2>
category headings. Programs cross-listed under multiple categories get a
single row with categories comma-joined — dedup is by program name (lowercased,
stripped), matching how import_to_d1.py upserts on the `name` UNIQUE constraint.
"""

from __future__ import annotations

import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag

from sources.base_source import BaseSource, ProgramRecord

SOURCE_URL = "https://www.mass.gov/lists/funding-resources"

# Subset of category heading text → program type.
# Match is substring, case-insensitive; first match wins.
_CATEGORY_TYPE_MAP = [
    ("tax credit", "Tax Credit"),
    ("tax incentive", "Tax Credit"),
    ("job incentive", "Tax Credit"),
    ("grant", "Grant"),
    ("venture capital", "Grant"),
    ("technical assistance", "Technical Assistance"),
    # "working capital" before "bond" so mixed categories like
    # "Working Capital, Bonds & Loans" default to Loan not Bond.
    ("working capital", "Loan"),
    ("real estate", "Loan"),
    ("equipment", "Loan"),
    ("acquiring", "Loan"),
    ("constructing", "Loan"),
    ("renovating", "Loan"),
    ("bond", "Bond"),
    ("loan", "Loan"),
]

# Known administering agencies to extract from description text.
_AGENCY_PATTERNS = [
    (re.compile(r"\bMassCEC\b", re.I), "MassCEC"),
    (re.compile(r"\bMass(?:achusetts)?\s+Clean\s+Energy\b", re.I), "MassCEC"),
    (re.compile(r"\bMassDevelopment\b", re.I), "MassDevelopment"),
    (re.compile(r"\bMassTech\b", re.I), "MassTech"),
    (re.compile(r"\bMLSC\b"), "MLSC"),
    (re.compile(r"\bMass(?:achusetts)?\s+Life\s+Sciences\b", re.I), "MLSC"),
    (re.compile(r"\bMassVentures\b", re.I), "MassVentures"),
    (re.compile(r"\bMass\s+Ventures\b", re.I), "MassVentures"),
]

_DEFAULT_SPONSOR = "Commonwealth of Massachusetts"


def _infer_type(category_text: str) -> str:
    lower = category_text.lower()
    for fragment, program_type in _CATEGORY_TYPE_MAP:
        if fragment in lower:
            return program_type
    return "Program"


def _extract_sponsor(text: str) -> str:
    for pattern, name in _AGENCY_PATTERNS:
        if pattern.search(text):
            return name
    return _DEFAULT_SPONSOR


class MassGovFundingSource(BaseSource):
    source_id = "mass_gov_funding_resources"

    def fetch(self) -> str:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (compatible; grant-manager-bot/1.0; "
                "+https://github.com/asiakay/grant-manager-tool-demo)"
            )
        }
        resp = requests.get(SOURCE_URL, headers=headers, timeout=30)
        resp.raise_for_status()
        return resp.text

    def parse(self, raw: str) -> list[ProgramRecord]:
        soup = BeautifulSoup(raw, "html.parser")

        # Keyed by normalized name so cross-listed programs merge into one row.
        records: dict[str, ProgramRecord] = {}

        # Walk every <h2> on the page; collect links that follow it until the
        # next <h2>. mass.gov uses a flat structure: h2 → sibling ul/div with
        # anchors inside. We use next_siblings to stay robust to minor CMS changes.
        for heading in soup.find_all("h2"):
            category = heading.get_text(strip=True)
            if not category:
                continue
            program_type = _infer_type(category)

            # Gather all <a> tags in siblings until the next h2.
            for sibling in heading.next_siblings:
                if isinstance(sibling, Tag):
                    if sibling.name == "h2":
                        break
                    for anchor in sibling.find_all("a", href=True):
                        self._process_anchor(anchor, category, program_type, records)

        return list(records.values())

    def _process_anchor(
        self,
        anchor: Tag,
        category: str,
        program_type: str,
        records: dict[str, ProgramRecord],
    ) -> None:
        name = anchor.get_text(strip=True)
        if not name:
            return

        href = anchor["href"]
        # Skip page-internal fragment links and non-program anchors.
        if href.startswith("#") or not href.strip():
            return

        url = urljoin(SOURCE_URL, href)

        # Pull description from the nearest sibling <p> or parent container text.
        description = ""
        parent = anchor.parent
        if parent:
            # Try the next <p> sibling of the anchor's parent.
            next_p = parent.find_next_sibling("p")
            if next_p:
                description = next_p.get_text(strip=True)
            if not description:
                # Fallback: text of the anchor's own container.
                description = parent.get_text(separator=" ", strip=True)

        sponsor = _extract_sponsor(description)
        key = name.lower().strip()

        if key in records:
            existing = records[key]
            if category not in existing.categories.split(", "):
                existing.categories = (
                    f"{existing.categories}, {category}"
                    if existing.categories
                    else category
                )
            # Prefer a more specific sponsor if we found one.
            if existing.sponsor == _DEFAULT_SPONSOR and sponsor != _DEFAULT_SPONSOR:
                existing.sponsor = sponsor
        else:
            records[key] = ProgramRecord(
                name=name,
                source_url=url,
                type=program_type,
                sponsor=sponsor,
                categories=category,
                benefits=description[:500] if description else "",
            )
