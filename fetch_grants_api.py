#!/usr/bin/env python3
"""Fetch grant opportunities from the Simpler Grants.gov API into a pipeline-compatible CSV.

Produces the same column schema as fetch_xml_extract.py so wrangle_grants.py,
program_scoring.py, and import_to_d1.py can consume both files without changes.

Usage:
  python fetch_grants_api.py
  python fetch_grants_api.py --limit 50 --debug
  python fetch_grants_api.py --agency-code DOE --agency-code EPA --min-award 50000
  python fetch_grants_api.py --status posted --deadline-before 2026-12-31

Requires: SIMPLER_GRANTS_API_KEY environment variable.
  Register at https://simpler.grants.gov to obtain a free API key.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import ssl
import sys
import urllib.error
import urllib.request
from typing import Dict, Iterator, List, Optional

import certifi

from fetch_xml_extract import OUTPUT_COLUMNS, _derive_relevance, _fmt_award

SIMPLER_API_URL = "https://api.simpler.grants.gov/v1/opportunities/search"
DEFAULT_OUTPUT = "data/csvs/grants_gov_api.csv"
PAGE_SIZE = 100
MAX_OPPORTUNITIES = 2000


def build_filter_body(
    agency_codes: Optional[List[str]],
    min_award: Optional[float],
    max_award: Optional[float],
    deadline_before: Optional[str],
    status: str,
) -> Dict:
    """Return the filters dict for the Simpler Grants.gov API POST body."""
    filters: Dict = {
        "funding_instrument": {"one_of": ["grant", "cooperative_agreement"]},
    }

    if status == "posted":
        filters["opportunity_status"] = {"one_of": ["posted"]}
    elif status == "forecasted":
        filters["opportunity_status"] = {"one_of": ["forecasted"]}
    else:
        filters["opportunity_status"] = {"one_of": ["posted", "forecasted"]}

    if agency_codes:
        filters["agency"] = {"one_of": agency_codes}

    # award_ceiling.min: ceiling can reach min_award (mirrors worker.js /api/grants filter)
    if min_award is not None:
        filters["award_ceiling"] = {"min": min_award}

    # award_floor.max: floor doesn't exceed the cap
    if max_award is not None:
        filters["award_floor"] = {"max": max_award}

    if deadline_before:
        filters["close_date"] = {"end_date": deadline_before}

    return filters


def fetch_page(
    api_key: str,
    query: str,
    page: int,
    page_size: int,
    filters: Dict,
    debug: bool = False,
) -> Dict:
    """POST one page to the Simpler Grants.gov search API and return parsed JSON."""
    payload = json.dumps({
        "query": query,
        "filters": filters,
        "pagination": {
            "page_offset": page,
            "page_size": page_size,
            "sort_order": [{"order_by": "relevancy", "sort_direction": "descending"}],
        },
    }).encode()

    req = urllib.request.Request(
        SIMPLER_API_URL,
        data=payload,
        headers={
            "X-API-Key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    context = ssl.create_default_context(cafile=certifi.where())
    try:
        with urllib.request.urlopen(req, context=context, timeout=30) as resp:
            body = resp.read()
            if debug:
                logging.debug("Page %d: %d bytes (status %s)", page, len(body), resp.status)
            return json.loads(body)
    except urllib.error.HTTPError as err:
        body_snippet = err.read(200).decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Simpler Grants API returned {err.code}: {body_snippet!r}"
        ) from err


def fetch_all_opportunities(
    api_key: str,
    filters: Dict,
    query: str = "",
    limit: Optional[int] = None,
    debug: bool = False,
) -> Iterator[Dict]:
    """Paginate the Simpler Grants.gov API, yielding raw opportunity dicts."""
    cap = min(limit, MAX_OPPORTUNITIES) if limit is not None else MAX_OPPORTUNITIES
    fetched = 0
    for page in range(1, 10_000):
        if fetched >= cap:
            break
        data = fetch_page(api_key, query, page, PAGE_SIZE, filters, debug)
        opps = data.get("data") or data.get("items") or []
        if not opps:
            break
        for opp in opps:
            if fetched >= cap:
                return
            yield opp
            fetched += 1
        logging.info("Page %d: fetched %d total so far", page, fetched)
        if len(opps) < PAGE_SIZE:
            break


def map_opportunity(opp: Dict) -> Dict[str, str]:
    """Map a single Simpler Grants.gov API opportunity to the pipeline CSV schema."""
    summary = opp.get("summary", {})
    if not isinstance(summary, dict):
        summary = {}

    opp_id = str(opp.get("opportunity_id") or "")
    title = (
        opp.get("opportunity_title")
        or summary.get("opportunity_title")
        or "Untitled Grant"
    )
    number = opp.get("opportunity_number") or ""
    agency = (
        opp.get("agency_name")
        or summary.get("agency_name")
        or opp.get("agency_code")
        or "Unknown Agency"
    )

    status_raw = (opp.get("opportunity_status") or "").lower()
    is_forecast = status_raw == "forecasted"
    stage = "Forecasted" if is_forecast else "Posted"

    fi_list = (
        opp.get("funding_instruments")
        or summary.get("funding_instruments")
        or []
    )
    type_raw = fi_list[0] if fi_list else "grant"
    type_label = type_raw.replace("_", " ").title()

    cfda_list = (
        opp.get("cfda_numbers")
        or opp.get("assistance_listing_numbers")
        or summary.get("assistance_listing_numbers")
        or []
    )
    cfda_str = ", ".join(str(c) for c in cfda_list)

    app_types = opp.get("applicant_types") or summary.get("applicant_types") or []
    eligible_str = ", ".join(t.replace("_", " ").title() for t in app_types)

    award_floor = opp.get("award_floor") if opp.get("award_floor") is not None else summary.get("award_floor")
    award_ceiling = opp.get("award_ceiling") if opp.get("award_ceiling") is not None else summary.get("award_ceiling")
    benefits = _fmt_award(
        str(award_floor) if award_floor is not None else "",
        str(award_ceiling) if award_ceiling is not None else "",
    )

    close_date = opp.get("close_date") or summary.get("close_date") or ""
    post_date = opp.get("post_date") or summary.get("post_date") or ""

    source_url = f"https://simpler.grants.gov/opportunity/{opp_id}" if opp_id else ""

    relevance_text = " ".join([title, agency, benefits, eligible_str])

    return {
        "Type": type_label,
        "Name": title,
        "Sponsor": agency,
        "Source URL": source_url,
        "Region / Eligibility": eligible_str,
        "Deadline / Next Cohort": close_date,
        "Cadence": "",
        "Benefits": benefits,
        "Eligibility (key conditions)": eligible_str,
        "Stage": stage,
        "Non-dilutive?": "Yes",
        "Stack Required?": "No",
        "Relevance": _derive_relevance(relevance_text),
        "Fit": "",
        "Ease": "",
        "Opportunity ID": opp_id,
        "Opportunity Number": number,
        "CFDA Numbers": cfda_str,
        "Eligible Applicants": eligible_str,
        "Award Ceiling": str(award_ceiling) if award_ceiling is not None else "",
        "Award Floor": str(award_floor) if award_floor is not None else "",
        "Is Forecast": "1" if is_forecast else "0",
        "Estimated Post Date": post_date,
        "Source Channel": "simpler_api",
    }


def write_csv(rows: Iterator[Dict], output_path: str) -> int:
    """Write mapped rows to a CSV. Returns count of rows written."""
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    written = 0
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({col: row.get(col, "") for col in OUTPUT_COLUMNS})
            written += 1
    return written


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description="Fetch grant opportunities from the Simpler Grants.gov API into a pipeline-compatible CSV."
    )
    parser.add_argument(
        "--output", default=DEFAULT_OUTPUT,
        help=f"Output CSV path (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Stop after N opportunities (useful for testing).",
    )
    parser.add_argument(
        "--agency-code", dest="agency_codes", action="append", default=None,
        help="Filter by agency code (repeatable). E.g. --agency-code DOE --agency-code EPA.",
    )
    parser.add_argument(
        "--min-award", type=float, default=None,
        help="Minimum award ceiling in dollars.",
    )
    parser.add_argument(
        "--max-award", type=float, default=None,
        help="Maximum award floor in dollars.",
    )
    parser.add_argument(
        "--deadline-before", default=None,
        help="Only include opportunities closing on or before this date (YYYY-MM-DD).",
    )
    parser.add_argument(
        "--status", choices=["posted", "forecasted", "both"], default="both",
        help="Opportunity status filter (default: both).",
    )
    parser.add_argument(
        "--query", default="",
        help="Free-text query (default: empty = all opportunities matching filters).",
    )
    parser.add_argument(
        "--debug", action="store_true", help="Enable debug logging.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    api_key = os.environ.get("SIMPLER_GRANTS_API_KEY", "").strip()
    if not api_key:
        logging.error(
            "SIMPLER_GRANTS_API_KEY environment variable is not set. "
            "Register at https://simpler.grants.gov to obtain a free API key."
        )
        sys.exit(1)

    filters = build_filter_body(
        agency_codes=args.agency_codes,
        min_award=args.min_award,
        max_award=args.max_award,
        deadline_before=args.deadline_before,
        status=args.status,
    )
    logging.info("Filters: %s", json.dumps(filters))

    raw_opps = fetch_all_opportunities(
        api_key=api_key,
        filters=filters,
        query=args.query,
        limit=args.limit,
        debug=args.debug,
    )
    rows = (map_opportunity(opp) for opp in raw_opps)
    count = write_csv(rows, args.output)
    print(f"OK: wrote {count} opportunit{'y' if count == 1 else 'ies'} to {args.output}")


if __name__ == "__main__":
    main()
