#!/usr/bin/env python3
"""Download and parse the Grants.gov XML Extract into a pipeline-compatible CSV.

The XML Extract (https://www.grants.gov/xml-extract) is a full daily dump of the
Grants.gov database — every posted opportunity (OpportunitySynopsisDetail_1_0) and
every forecasted opportunity not yet posted (OpportunityForecastDetail_1_0), zipped
as "GrantsDBExtract<YYYYMMDD>v2.zip". Unlike search_grants.py's keyword search or
syncGrantsWithD1's paginated API sync, this is the complete catalog in one file —
no query terms, no API key, no pagination.

Output columns match what wrangle_grants.py / program_scoring.py / import_to_d1.py
already expect (see D1_COLUMNS in import_to_d1.py), plus the structured fields those
scripts previously had no source for: Opportunity ID, Opportunity Number, CFDA
Numbers, Eligible Applicants, Award Ceiling, Award Floor, Is Forecast, Estimated
Post Date, Source Channel.

Usage:
  python fetch_xml_extract.py
  python fetch_xml_extract.py --date 20260701 --output data/csvs/extract.csv
  python fetch_xml_extract.py --limit 50 --output /tmp/sample.csv
  python fetch_xml_extract.py --from-file cache/GrantsDBExtract20260701v2.zip
"""

from __future__ import annotations

import argparse
import csv
import datetime
import io
import logging
import os
import ssl
import sys
import urllib.error
import urllib.request
import zipfile
from typing import Dict, Iterator, List, Optional
from xml.etree import ElementTree as ET

import certifi

EXTRACT_URL_TEMPLATE = "https://www.grants.gov/extract/GrantsDBExtract{date}v2.zip"

# Element (local name, namespace stripped) -> Is Forecast flag.
SYNOPSIS_TAG = "OpportunitySynopsisDetail_1_0"
FORECAST_TAG = "OpportunityForecastDetail_1_0"

# Grants.gov's published FundingInstrumentType code table.
FUNDING_INSTRUMENT_LABELS: Dict[str, str] = {
    "CA": "Cooperative Agreement",
    "G": "Grant",
    "PC": "Procurement Contract",
    "O": "Other",
}

# Grants.gov's published EligibleApplicantTypes code table. Raw codes like "25"/"21"
# are meaningless to an end user, so every eligibility field is decoded through this
# before it's written to the CSV (and, downstream, surfaced as filter chips in the UI).
ELIGIBLE_APPLICANT_LABELS: Dict[str, str] = {
    "00": "State governments",
    "01": "County governments",
    "02": "City or township governments",
    "04": "Special district governments",
    "05": "Independent school districts",
    "06": "Public and State controlled institutions of higher education",
    "07": "Native American tribal governments (Federally recognized)",
    "08": "Public housing authorities/Indian housing authorities",
    "11": "Native American tribal organizations (other than Federally recognized)",
    "12": "Nonprofits with a 501(c)(3) status (other than higher education)",
    "13": "Nonprofits without a 501(c)(3) status (other than higher education)",
    "20": "Private institutions of higher education",
    "21": "Individuals",
    "22": "For-profit organizations other than small businesses",
    "23": "Small businesses",
    "25": "All types of local governments",
    "99": "Unrestricted (open to any applicant type, subject to notice)",
}


def _decode_labels(codes: List[str], table: Dict[str, str]) -> List[str]:
    return [table.get(c, c) for c in codes]

# Same domain taxonomy used by worker.js's FOCUS_AREA_KEYWORDS / derivedRelevance,
# kept in sync so Relevance scores are comparable across the XML-extract and
# Simpler-Grants.gov-API ingestion channels.
FOCUS_AREA_KEYWORDS: Dict[str, List[str]] = {
    "Health & Medicine": ["health", "medicine", "medical", "clinical", "biomedical", "disease", "drug", "therapeutics", "patient"],
    "Education & Workforce": ["education", "workforce", "training", "learning", "student", "school", "academic", "career"],
    "Technology & Innovation": ["technology", "innovation", "tech", "software", "digital", "engineering", "data", "ai", "computing"],
    "Housing & Community": ["housing", "community", "neighborhood", "affordable", "urban", "rural", "infrastructure"],
    "Environment & Climate": ["environment", "climate", "energy", "sustainability", "clean", "emissions", "carbon", "ecology", "conservation", "biodiversity", "water", "pollution", "resilience", "natural resources", "land use"],
    "Agriculture & Food": ["agriculture", "food", "farm", "crop", "nutrition", "rural", "livestock"],
    "Social Services": ["social", "welfare", "poverty", "disability", "elderly", "child", "family", "services"],
    "Arts & Humanities": ["arts", "humanities", "culture", "museum", "heritage", "creative", "media"],
    "International Development": ["international", "global", "developing", "foreign", "overseas", "aid"],
    "Veterans & Military": ["veteran", "military", "defense", "armed forces", "service member"],
    "Research & Science": ["research", "science", "scientific", "laboratory", "study", "investigation"],
    "Justice & Safety": ["justice", "safety", "law", "crime", "court", "police", "legal", "equity"],
}

# Output CSV column order. Matches import_to_d1.py's D1_COLUMNS (human-readable
# headers) plus the new Grants.gov-sourced columns from migration 0009.
OUTPUT_COLUMNS = [
    "Type", "Name", "Sponsor", "Source URL", "Region / Eligibility",
    "Deadline / Next Cohort", "Cadence", "Benefits", "Eligibility (key conditions)",
    "Stage", "Non-dilutive?", "Stack Required?", "Relevance", "Fit", "Ease",
    "Opportunity ID", "Opportunity Number", "CFDA Numbers", "Eligible Applicants",
    "Award Ceiling", "Award Floor", "Is Forecast", "Estimated Post Date",
    "Source Channel",
]


def _localname(tag: str) -> str:
    """Strip a namespace URI ("{uri}Tag" -> "Tag") so parsing doesn't depend on
    Grants.gov's exact XML namespace, which has changed between extract versions."""
    return tag.split("}", 1)[1] if "}" in tag else tag


def _child_text(elem: ET.Element, name: str) -> str:
    for child in elem:
        if _localname(child.tag) == name:
            return (child.text or "").strip()
    return ""


def _child_texts(elem: ET.Element, name: str) -> List[str]:
    return [
        (child.text or "").strip()
        for child in elem
        if _localname(child.tag) == name and (child.text or "").strip()
    ]


def _fmt_award(floor: str, ceiling: str) -> str:
    """Mirrors fmtAward() in worker.js so Benefits reads the same regardless of
    which ingestion channel produced the row."""
    def fmt(n: str) -> str:
        try:
            return "${:,.0f}".format(float(n))
        except (TypeError, ValueError):
            return ""

    f, c = fmt(floor), fmt(ceiling)
    if f and c:
        return f"{f} – {c}"
    if c:
        return f"Up to {c}"
    if f:
        return f"From {f}"
    return ""


def _derive_relevance(text: str) -> float:
    """Same keyword-domain-count heuristic as derivedRelevance in worker.js's
    syncGrantsWithD1, so Relevance isn't uniformly zero for bulk-imported rows
    that haven't been through the AI scoring pass yet."""
    text = text.lower()
    domain_count = sum(
        1 for kws in FOCUS_AREA_KEYWORDS.values() if any(kw in text for kw in kws)
    )
    return round(min(3, (domain_count / len(FOCUS_AREA_KEYWORDS)) * 3), 1)


def resolve_extract_url(date: datetime.date) -> str:
    return EXTRACT_URL_TEMPLATE.format(date=date.strftime("%Y%m%d"))


def download_extract(date: datetime.date, max_lookback: int, debug: bool = False) -> bytes:
    """Download the zip for `date`, stepping backward up to `max_lookback` days if a
    given day's extract wasn't published (e.g. weekends/holidays)."""
    context = ssl.create_default_context(cafile=certifi.where())
    last_err: Optional[Exception] = None
    for offset in range(max_lookback + 1):
        attempt_date = date - datetime.timedelta(days=offset)
        url = resolve_extract_url(attempt_date)
        logging.debug("GET %s", url)
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; FoundationPlannerBot/1.0)"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, context=context, timeout=60) as resp:
                data = resp.read()
                if debug:
                    logging.debug("Downloaded %d bytes from %s", len(data), url)
                return data
        except urllib.error.HTTPError as err:
            last_err = err
            logging.info("No extract at %s (%s); trying an earlier date.", url, err.code)
        except (urllib.error.URLError, ssl.SSLError, TimeoutError) as err:
            last_err = err
            logging.warning("Failed to fetch %s: %s", url, err)
    raise RuntimeError(
        f"Could not download a Grants.gov XML extract within {max_lookback} day(s) "
        f"of {date.isoformat()}: {last_err}"
    )


def extract_xml_bytes(zip_bytes: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        xml_names = [n for n in zf.namelist() if n.lower().endswith(".xml")]
        if not xml_names:
            raise RuntimeError(f"No .xml file found inside extract zip (entries: {zf.namelist()})")
        return zf.read(xml_names[0])


def parse_opportunities(xml_bytes: bytes, limit: Optional[int] = None) -> Iterator[Dict[str, str]]:
    """Stream-parse OpportunitySynopsisDetail_1_0 / OpportunityForecastDetail_1_0
    elements and yield one output row per opportunity. Uses iterparse + elem.clear()
    so full-catalog extracts (tens of thousands of records) don't require holding
    the whole tree in memory."""
    count = 0
    for _event, elem in ET.iterparse(io.BytesIO(xml_bytes), events=("end",)):
        tag = _localname(elem.tag)
        if tag not in (SYNOPSIS_TAG, FORECAST_TAG):
            continue
        is_forecast = tag == FORECAST_TAG

        opp_id = _child_text(elem, "OpportunityID")
        title = _child_text(elem, "OpportunityTitle") or "Untitled Grant"
        number = _child_text(elem, "OpportunityNumber")
        agency = _child_text(elem, "AgencyName") or _child_text(elem, "AgencyCode") or "Unknown Agency"
        funding_types = _child_texts(elem, "FundingInstrumentType")
        cfda = _child_texts(elem, "CFDANumbers")
        eligible = _child_texts(elem, "EligibleApplicants")
        award_floor = _child_text(elem, "AwardFloor")
        award_ceiling = _child_text(elem, "AwardCeiling")
        cost_sharing = _child_text(elem, "CostSharingOrMatchingRequirement")

        if is_forecast:
            deadline = _child_text(elem, "EstimatedSynopsisCloseDate")
            estimated_post_date = _child_text(elem, "EstimatedSynopsisPostDate")
            status = "Forecasted"
        else:
            deadline = _child_text(elem, "CloseDate")
            estimated_post_date = ""
            status = "Posted"

        source_url = f"https://www.grants.gov/search-results-detail/{opp_id}" if opp_id else ""
        benefits = _fmt_award(award_floor, award_ceiling)
        eligible_labels = _decode_labels(eligible, ELIGIBLE_APPLICANT_LABELS)
        eligibility_text = ", ".join(eligible_labels)
        funding_type_label = FUNDING_INSTRUMENT_LABELS.get(funding_types[0], funding_types[0]) if funding_types else "Grant"
        relevance_text = " ".join([title, agency, benefits, eligibility_text])

        row = {
            "Type": funding_type_label,
            "Name": title,
            "Sponsor": agency,
            "Source URL": source_url,
            "Region / Eligibility": eligibility_text,
            "Deadline / Next Cohort": deadline,
            "Cadence": "",
            "Benefits": benefits,
            "Eligibility (key conditions)": eligibility_text,
            "Stage": status,
            "Non-dilutive?": "Yes",
            "Stack Required?": "No",
            "Relevance": _derive_relevance(relevance_text),
            "Fit": "",
            "Ease": "" if not cost_sharing else ("1" if cost_sharing.lower() in ("n", "no", "false") else "0"),
            "Opportunity ID": opp_id,
            "Opportunity Number": number,
            "CFDA Numbers": ", ".join(cfda),
            "Eligible Applicants": eligibility_text,
            "Award Ceiling": award_ceiling,
            "Award Floor": award_floor,
            "Is Forecast": "1" if is_forecast else "0",
            "Estimated Post Date": estimated_post_date,
            "Source Channel": "xml_extract",
        }
        yield row

        elem.clear()
        count += 1
        if limit is not None and count >= limit:
            break


def write_csv(rows: Iterator[Dict[str, str]], output_path: str) -> int:
    written = 0
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({col: row.get(col, "") for col in OUTPUT_COLUMNS})
            written += 1
    return written


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Fetch and parse the Grants.gov XML Extract")
    parser.add_argument(
        "--date",
        help="Extract date as YYYYMMDD (default: today, UTC). Steps backward on 404.",
    )
    parser.add_argument(
        "--max-lookback",
        type=int,
        default=5,
        help="Days to step backward looking for a published extract (default: 5).",
    )
    parser.add_argument(
        "--output",
        default="data/csvs/grants_gov_extract.csv",
        help="Output CSV path (default: data/csvs/grants_gov_extract.csv).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after N opportunities (useful for local testing without a full download).",
    )
    parser.add_argument(
        "--from-file",
        help="Parse a previously-downloaded .zip or .xml file instead of hitting the network.",
    )
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if args.from_file:
        with open(args.from_file, "rb") as f:
            raw = f.read()
        xml_bytes = extract_xml_bytes(raw) if args.from_file.lower().endswith(".zip") else raw
    else:
        target_date = (
            datetime.datetime.strptime(args.date, "%Y%m%d").date()
            if args.date
            else datetime.datetime.now(datetime.timezone.utc).date()
        )
        zip_bytes = download_extract(target_date, args.max_lookback, debug=args.debug)
        xml_bytes = extract_xml_bytes(zip_bytes)

    rows = parse_opportunities(xml_bytes, limit=args.limit)

    out_dir = os.path.dirname(args.output)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    count = write_csv(rows, args.output)
    print(f"OK: wrote {count} opportunit{'y' if count == 1 else 'ies'} to {args.output}")


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    sys.exit(main() or 0)
