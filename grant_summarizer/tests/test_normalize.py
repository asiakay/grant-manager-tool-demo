from grant_summarizer.normalize import normalize_fields
from grant_summarizer.schema import CleanRow


def test_normalize_fields_basic():
    windows = {
        "grant_name": "Test Grant",
        "sponsor_org": "DOL",
        "award_max": "$5M",
        "app_deadline": "Jan 1, 2025",
    }
    row = normalize_fields(windows)
    assert isinstance(row, CleanRow)
    assert row.grant_name == "Test Grant"
    assert row.app_deadline == "Jan 1, 2025"


def test_normalize_missing_defaults():
    row = normalize_fields({})
    assert row.grant_name == ""
    assert row.sponsor_org == ""
