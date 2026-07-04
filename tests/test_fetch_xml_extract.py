"""
pytest suite for fetch_xml_extract.py.

Exercises the Grants.gov XML Extract parsing path against a hand-built fixture
(tests/fixtures/sample_extract.xml) matching the real OpportunitySynopsisDetail_1_0 /
OpportunityForecastDetail_1_0 schema, plus the URL-resolution / date-fallback logic
and zip-vs-plain-XML input handling. No network calls are made.
"""

import datetime
import io
import zipfile
from pathlib import Path

import pytest

from fetch_xml_extract import (
    _decode_labels,
    _derive_relevance,
    _fmt_award,
    _localname,
    ELIGIBLE_APPLICANT_LABELS,
    FUNDING_INSTRUMENT_LABELS,
    OUTPUT_COLUMNS,
    download_extract,
    extract_xml_bytes,
    parse_opportunities,
    resolve_extract_url,
    write_csv,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "sample_extract.xml"


@pytest.fixture
def fixture_xml_bytes() -> bytes:
    return FIXTURE_PATH.read_bytes()


@pytest.fixture
def rows(fixture_xml_bytes):
    return list(parse_opportunities(fixture_xml_bytes))


# ---------------------------------------------------------------------------
# URL resolution
# ---------------------------------------------------------------------------

def test_resolve_extract_url_format():
    url = resolve_extract_url(datetime.date(2026, 7, 2))
    assert url == "https://www.grants.gov/extract/GrantsDBExtract20260702v2.zip"


class _FakeResponse:
    """Minimal stand-in for http.client.HTTPResponse covering what
    download_extract() reads: .read(), .status, .headers.get(...)."""

    def __init__(self, data: bytes, status: int = 200, content_type: str = "application/zip"):
        self._data = data
        self.status = status
        self.headers = {"Content-Type": content_type}

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


_REAL_ZIP_BYTES = b"PK\x03\x04zip-bytes-for-earlier-day"


def test_download_extract_falls_back_on_404(monkeypatch):
    """Simulates today's extract 404ing (not yet published) and yesterday's succeeding."""
    import urllib.error
    import fetch_xml_extract as mod

    calls = []

    def fake_urlopen(req, context=None, timeout=None):
        calls.append(req.full_url)
        if req.full_url.endswith("20260702v2.zip"):
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)
        return _FakeResponse(_REAL_ZIP_BYTES)

    monkeypatch.setattr(mod.urllib.request, "urlopen", fake_urlopen)
    data = download_extract(datetime.date(2026, 7, 2), max_lookback=3)
    assert data == _REAL_ZIP_BYTES
    assert len(calls) == 2
    assert calls[0].endswith("20260702v2.zip")
    assert calls[1].endswith("20260701v2.zip")


def test_download_extract_raises_after_exhausting_lookback(monkeypatch):
    import urllib.error
    import fetch_xml_extract as mod

    def always_404(req, context=None, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

    monkeypatch.setattr(mod.urllib.request, "urlopen", always_404)
    with pytest.raises(RuntimeError, match="Could not download"):
        download_extract(datetime.date(2026, 7, 2), max_lookback=2)


def test_download_extract_falls_back_when_response_is_not_actually_a_zip(monkeypatch):
    """Regression test: grants.gov's WAF/CDN can return 200 OK with an HTML block
    page instead of a real 404 for a blocked/unpublished URL. That used to sail
    through as a "successful" download and crash later inside zipfile.ZipFile
    with BadZipFile, without ever trying an earlier date. It must now be treated
    like a 404 and retried."""
    import fetch_xml_extract as mod

    calls = []

    def fake_urlopen(req, context=None, timeout=None):
        calls.append(req.full_url)
        if req.full_url.endswith("20260702v2.zip"):
            return _FakeResponse(b"<html><body>Access Denied</body></html>", content_type="text/html")
        return _FakeResponse(_REAL_ZIP_BYTES)

    monkeypatch.setattr(mod.urllib.request, "urlopen", fake_urlopen)
    data = download_extract(datetime.date(2026, 7, 2), max_lookback=3)
    assert data == _REAL_ZIP_BYTES
    assert len(calls) == 2


def test_download_extract_raises_with_diagnostic_info_when_every_attempt_is_blocked(monkeypatch):
    import fetch_xml_extract as mod

    def always_blocked(req, context=None, timeout=None):
        return _FakeResponse(b"<html>blocked</html>", content_type="text/html")

    monkeypatch.setattr(mod.urllib.request, "urlopen", always_blocked)
    with pytest.raises(RuntimeError, match="isn't a zip file"):
        download_extract(datetime.date(2026, 7, 2), max_lookback=1)


# ---------------------------------------------------------------------------
# Zip / XML extraction
# ---------------------------------------------------------------------------

def test_extract_xml_bytes_reads_the_xml_entry(fixture_xml_bytes):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("GrantsDBExtract20260702v2.xml", fixture_xml_bytes)
    extracted = extract_xml_bytes(buf.getvalue())
    assert extracted == fixture_xml_bytes


def test_extract_xml_bytes_raises_without_xml_entry():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("readme.txt", b"not xml")
    with pytest.raises(RuntimeError, match="No .xml file"):
        extract_xml_bytes(buf.getvalue())


# ---------------------------------------------------------------------------
# Namespace-stripping helpers
# ---------------------------------------------------------------------------

def test_localname_strips_namespace():
    assert _localname("{http://apply.grants.gov/system/OpportunityDetail-V1.0}OpportunityID") == "OpportunityID"
    assert _localname("OpportunityID") == "OpportunityID"


# ---------------------------------------------------------------------------
# Field decoding helpers
# ---------------------------------------------------------------------------

def test_fmt_award_ranges():
    assert _fmt_award("100000", "5000000") == "$100,000 – $5,000,000"
    assert _fmt_award("", "750000") == "Up to $750,000"
    assert _fmt_award("50000", "") == "From $50,000"
    assert _fmt_award("", "") == ""


def test_decode_labels_maps_known_codes_and_passes_through_unknown():
    assert _decode_labels(["25", "21"], ELIGIBLE_APPLICANT_LABELS) == [
        "All types of local governments",
        "Individuals",
    ]
    assert _decode_labels(["ZZ"], ELIGIBLE_APPLICANT_LABELS) == ["ZZ"]
    assert FUNDING_INSTRUMENT_LABELS["G"] == "Grant"
    assert FUNDING_INSTRUMENT_LABELS["CA"] == "Cooperative Agreement"


def test_derive_relevance_scores_higher_for_more_matched_domains():
    housing_text = "affordable housing community development grant"
    unrelated_text = "xyzzy plugh quux"
    assert _derive_relevance(housing_text) > 0
    assert _derive_relevance(unrelated_text) == 0


# ---------------------------------------------------------------------------
# End-to-end parsing against the real-shaped fixture
# ---------------------------------------------------------------------------

def test_parse_opportunities_yields_one_row_per_record(rows):
    assert len(rows) == 3


def test_parse_synopsis_record_fields(rows):
    row = next(r for r in rows if r["Opportunity ID"] == "123456")
    assert row["Name"] == "Rural Broadband Infrastructure Grants"
    assert row["Sponsor"] == "Rural Utilities Service"
    assert row["Source URL"] == "https://www.grants.gov/search-results-detail/123456"
    assert row["Deadline / Next Cohort"] == "09/15/2026"
    assert row["Award Ceiling"] == "5000000"
    assert row["Award Floor"] == "100000"
    assert row["Benefits"] == "$100,000 – $5,000,000"
    assert row["CFDA Numbers"] == "10.855"
    assert row["Eligible Applicants"] == "All types of local governments, Individuals"
    assert row["Is Forecast"] == "0"
    assert row["Stage"] == "Posted"
    assert row["Estimated Post Date"] == ""
    assert row["Source Channel"] == "xml_extract"
    assert row["Type"] == "Grant"


def test_parse_forecast_record_uses_forecast_fields(rows):
    row = next(r for r in rows if r["Opportunity ID"] == "223456")
    assert row["Is Forecast"] == "1"
    assert row["Stage"] == "Forecasted"
    assert row["Deadline / Next Cohort"] == "12/01/2026"  # EstimatedSynopsisCloseDate
    assert row["Estimated Post Date"] == "10/01/2026"
    assert row["CFDA Numbers"] == "81.086"


def test_parse_handles_missing_award_floor_gracefully(rows):
    row = next(r for r in rows if r["Opportunity ID"] == "123457")
    assert row["Award Floor"] == ""
    assert row["Benefits"] == "Up to $750,000"


def test_parse_opportunities_respects_limit(fixture_xml_bytes):
    limited = list(parse_opportunities(fixture_xml_bytes, limit=1))
    assert len(limited) == 1


def test_relevance_is_never_uniformly_zero(rows):
    # Every fixture row mentions at least one FOCUS_AREA_KEYWORDS domain term,
    # so none should default to a flat 0 the way pre-heuristic bulk imports did.
    assert all(float(r["Relevance"]) > 0 for r in rows)


# ---------------------------------------------------------------------------
# CSV output
# ---------------------------------------------------------------------------

def test_write_csv_uses_full_output_columns(tmp_path, rows):
    out_path = tmp_path / "extract.csv"
    count = write_csv(iter(rows), str(out_path))
    assert count == 3

    import csv
    with open(out_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == OUTPUT_COLUMNS
        written_rows = list(reader)
    assert len(written_rows) == 3
    assert written_rows[0]["Name"]  # non-empty
