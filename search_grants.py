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
import urllib.error
import ssl
import certifi
from typing import Dict, List, Any

import pandas as pd

SEARCH_URL = "https://www.grants.gov/grantsws/rest/opportunities/search"
DETAIL_URL = "https://www.grants.gov/grantsws/rest/opportunities/{id}/synopsis"


def _get_json(
    url: str,
    params: Dict[str, str] | None = None,
    debug: bool = False,
    *,
    method: str = "GET",
    data: Any | None = None,
) -> Dict:
    """Fetch JSON data from ``url`` using ``method`` and optional JSON ``data``."""
    if params and method.upper() == "GET":
        url = f"{url}?{urllib.parse.urlencode(params)}"
    headers: Dict[str, str] = {}
    body: bytes | None = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    logging.debug("%s %s", method.upper(), url)
    context = ssl.create_default_context(cafile=certifi.where())
    req = urllib.request.Request(url, data=body, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, context=context) as resp:  # noqa: S310 - network call intended
            text = resp.read().decode("utf-8")
            if resp.status != 200:
                logging.error("Request to %s returned %s: %s", url, resp.status, text[:200])
                return {}
    except urllib.error.HTTPError as err:  # pragma: no cover - network error handling
        body = err.read().decode("utf-8", errors="replace")
        logging.error("Request to %s failed with %s: %s", url, err.code, body[:200])
        return {}
    except (urllib.error.URLError, ssl.SSLError) as err:  # pragma: no cover - network error handling
        logging.error("Failed to fetch %s: %s", url, err)
        return {}
    if debug:
        logging.debug("Response: %s", text[:1000])
    return json.loads(text)


def search_grants(keyword: str, filters: Dict[str, str], debug: bool = False) -> List[Dict]:
    """Return a list of opportunities matching ``keyword`` and ``filters``."""
    payload = {"keywords": keyword, "limit": "20", **filters}
    data = _get_json(SEARCH_URL, debug=debug, method="POST", data=payload)
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
