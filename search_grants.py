#!/usr/bin/env python3
"""Search Grants.gov and export results.

This CLI queries the Grants.gov search API using keywords and optional filters,
then enriches each opportunity with details from the opportunity synopsis
endpoint. Results can be written to CSV or TSV and a curated summary table is
printed for quick review.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import urllib.parse
import urllib.request
from typing import Dict, List

import pandas as pd

SEARCH_URL = "https://www.grants.gov/grantsws/rest/opportunities/search"
DETAIL_URL = "https://www.grants.gov/grantsws/rest/opportunities/{id}/synopsis"


def _get_json(url: str, params: Dict[str, str] | None = None, debug: bool = False) -> Dict:
    """Fetch JSON data from ``url`` with optional query ``params``."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    logging.debug("GET %s", url)
    with urllib.request.urlopen(url) as resp:  # noqa: S310 - network call intended
        text = resp.read().decode("utf-8")
    if debug:
        logging.debug("Response: %s", text[:1000])
    return json.loads(text)


def search_grants(keyword: str, filters: Dict[str, str], debug: bool = False) -> List[Dict]:
    """Return a list of opportunities matching ``keyword`` and ``filters``."""
    params = {"keywords": keyword, "limit": "20", **filters}
    data = _get_json(SEARCH_URL, params, debug=debug)
    return data.get("opportunities", [])


def fetch_detail(opp_id: str, debug: bool = False) -> Dict:
    """Fetch detail JSON for a single opportunity ``opp_id``."""
    url = DETAIL_URL.format(id=opp_id)
    data = _get_json(url, debug=debug)
    # Some responses nest the opportunity under "opportunity"
    return data.get("opportunity", data)


def build_summary(opportunities: List[Dict], debug: bool = False) -> pd.DataFrame:
    """Create a summary DataFrame with curated columns."""
    rows: List[Dict[str, str]] = []
    for opp in opportunities:
        opp_id = str(opp.get("id") or opp.get("opportunityId"))
        detail = fetch_detail(opp_id, debug=debug)
        rows.append(
            {
                "Grant name": opp.get("title"),
                "Award max": detail.get("awardCeiling"),
                "App deadline": opp.get("closeDate"),
                "Timeline summary": f"{opp.get('openDate')} to {opp.get('closeDate')}",
            }
        )
    return pd.DataFrame(rows)


def parse_filters(raw_filters: List[str]) -> Dict[str, str]:
    """Parse CLI ``key=value`` pairs into a dict."""
    filters: Dict[str, str] = {}
    for item in raw_filters:
        if "=" in item:
            k, v = item.split("=", 1)
            filters[k] = v
    return filters


def main(argv: List[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Search Grants.gov opportunities")
    parser.add_argument("keyword", help="Keyword to search for")
    parser.add_argument(
        "--filter",
        action="append",
        default=[],
        help="Additional search filters in key=value form. Can be repeated.",
    )
    parser.add_argument(
        "--output",
        default="grants.csv",
        help="Output file path (CSV or TSV)",
    )
    parser.add_argument(
        "--format", choices=["csv", "tsv"], default="csv", help="Output format"
    )
    parser.add_argument(
        "--debug", action="store_true", help="Enable debug logging of requests"
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    filters = parse_filters(args.filter)
    opportunities = search_grants(args.keyword, filters, debug=args.debug)
    if not opportunities:
        logging.info("No opportunities found.")
        return

    summary = build_summary(opportunities, debug=args.debug)
    sep = "," if args.format == "csv" else "\t"
    summary.to_csv(args.output, index=False, sep=sep)
    print(summary.to_string(index=False))


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
