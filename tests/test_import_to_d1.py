"""
pytest suite for import_to_d1.py.

Covers the header-resolution fix (human-readable CSV headers -> real snake_case
D1 columns, including the "Source URL" alias gap that also existed in worker.js's
CSV_COLUMN_ALIASES) and the chained-ON-CONFLICT upsert SQL generation, in
particular that notes/pdf_url/ai_* columns are never present in the SET clause
and that opportunity_id is emitted as SQL NULL (not '') when absent.
"""

import re

import pandas as pd
import pytest

from import_to_d1 import (
    PRESERVED_COLUMNS,
    _escape,
    _sql_value,
    build_sql,
    load_and_validate,
    prepare_rows,
    resolve_columns,
    resolve_header,
)


# ---------------------------------------------------------------------------
# Header resolution
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "header,expected",
    [
        ("Name", "name"),
        ("Source URL", "source_url"),  # previously unmapped — see CSV_COLUMN_ALIASES comment
        ("Link", "source_url"),
        ("Region / Eligibility", "region_eligibility"),
        ("Deadline / Next Cohort", "deadline"),
        ("Non-dilutive?", "non_dilutive"),
        ("Stack Required?", "stack_required"),
        ("Eligibility (key conditions)", "eligibility_conditions"),
        ("Weighted Score", "weighted_score"),
        ("Opportunity ID", "opportunity_id"),
        ("Opportunity Number", "opportunity_number"),
        ("CFDA Numbers", "cfda_numbers"),
        ("Eligible Applicants", "eligible_applicants"),
        ("Award Ceiling", "award_ceiling"),
        ("Award Floor", "award_floor"),
        ("Is Forecast", "is_forecast"),
        ("Estimated Post Date", "estimated_post_date"),
        ("Source Channel", "source_channel"),
    ],
)
def test_resolve_header_maps_known_headers(header, expected):
    assert resolve_header(header) == expected


def test_resolve_columns_drops_preserved_and_unknown_columns():
    df = pd.DataFrame(columns=["Name", "Notes/Actions", "Some Unknown Column", "Award Ceiling"])
    mapping = resolve_columns(df)
    assert mapping["Name"] == "name"
    assert mapping["Award Ceiling"] == "award_ceiling"
    # notes is a PRESERVED_COLUMNS entry, not in D1_COLUMN_TYPES — must not be written
    assert "Notes/Actions" not in mapping
    assert "Some Unknown Column" not in mapping


def test_preserved_columns_are_never_writable():
    df = pd.DataFrame(columns=["Notes/Actions", "pdf_url", "ai_score", "ai_summary", "ai_tier", "ai_scored_at"])
    mapping = resolve_columns(df)
    assert mapping == {}
    for col in PRESERVED_COLUMNS:
        assert resolve_header(col) not in mapping.values()


# ---------------------------------------------------------------------------
# SQL value coercion
# ---------------------------------------------------------------------------

def test_sql_value_real_column_blank_is_null():
    assert _sql_value("award_ceiling", "") == "NULL"
    assert _sql_value("award_ceiling", "5000000") == "5000000.0"
    assert _sql_value("award_ceiling", "not-a-number") == "NULL"


def test_sql_value_bool_column_variants():
    assert _sql_value("non_dilutive", "Yes") == "1"
    assert _sql_value("non_dilutive", "no") == "0"
    assert _sql_value("non_dilutive", "") == "NULL"
    assert _sql_value("is_forecast", "1") == "1"
    assert _sql_value("is_forecast", "0") == "0"


def test_sql_value_opportunity_id_blank_is_null_not_empty_string():
    # Critical: the partial unique index is `WHERE opportunity_id IS NOT NULL`.
    # If blank produced '' instead of NULL, multiple ID-less rows would collide
    # on uniqueness the first time two of them synced in the same batch.
    assert _sql_value("opportunity_id", "") == "NULL"
    assert _sql_value("opportunity_id", "123456") == _escape("123456")


def test_sql_value_text_column_blank_is_empty_string():
    assert _sql_value("cadence", "") == _escape("")
    assert _sql_value("sponsor", "Acme") == _escape("Acme")


# ---------------------------------------------------------------------------
# Upsert SQL generation
# ---------------------------------------------------------------------------

def _build_single_row_sql(columns, row):
    return build_sql([row], columns, "2026-07-02T00:00:00+00:00")


def test_build_sql_never_touches_preserved_columns():
    columns = ["name", "sponsor", "opportunity_id"]
    row = {"name": "Test Grant", "sponsor": "Acme", "opportunity_id": "999"}
    sql = _build_single_row_sql(columns, row)
    for preserved in PRESERVED_COLUMNS:
        assert preserved not in sql, f"{preserved} must never appear in generated SQL"


def test_build_sql_has_chained_conflict_targets():
    columns = ["name", "sponsor", "opportunity_id"]
    row = {"name": "Test Grant", "sponsor": "Acme", "opportunity_id": "999"}
    sql = _build_single_row_sql(columns, row)
    assert "ON CONFLICT(opportunity_id) WHERE opportunity_id IS NOT NULL DO UPDATE SET" in sql
    assert "ON CONFLICT(name) DO UPDATE SET" in sql
    # The opportunity_id branch must come first so an ID match takes priority
    # over a stale name match.
    assert sql.index("ON CONFLICT(opportunity_id)") < sql.index("ON CONFLICT(name)")


def test_build_sql_set_clause_only_references_inserted_columns():
    """Every `excluded.<col>` reference must correspond to a column actually
    present in the INSERT's column list — referencing anything else is invalid
    SQL. Regression test for a bug caught during manual verification where the
    SET clause unconditionally referenced opportunity_id even when the CSV
    didn't have that column."""
    columns = ["name", "sponsor"]  # deliberately no opportunity_id
    row = {"name": "Test Grant", "sponsor": "Acme"}
    sql = _build_single_row_sql(columns, row)

    insert_cols = set(re.search(r"INSERT INTO programs \(([^)]+)\)", sql).group(1).replace(" ", "").split(","))
    excluded_refs = set(re.findall(r"excluded\.(\w+)", sql))
    assert excluded_refs <= insert_cols, f"SET clause references columns not in INSERT list: {excluded_refs - insert_cols}"
    assert "opportunity_id" not in insert_cols


def test_build_sql_batches_by_batch_size(monkeypatch):
    import import_to_d1

    monkeypatch.setattr(import_to_d1, "BATCH_SIZE", 2)
    columns = ["name"]
    rows = [{"name": f"Grant {i}"} for i in range(5)]
    sql = import_to_d1.build_sql(rows, columns, "2026-07-02T00:00:00+00:00")
    # 5 rows at batch size 2 -> 3 statements -> 3 "INSERT INTO programs" occurrences
    assert sql.count("INSERT INTO programs") == 3


def test_build_sql_empty_rows_returns_empty_string():
    assert build_sql([], ["name"], "2026-07-02T00:00:00+00:00") == ""


# ---------------------------------------------------------------------------
# End-to-end CSV -> rows
# ---------------------------------------------------------------------------

def test_load_and_validate_resolves_headers_and_drops_blank_names(tmp_path):
    csv_path = tmp_path / "scored.csv"
    csv_path.write_text(
        "Name,Source URL,Award Ceiling,Notes/Actions\n"
        "Grant A,https://example.com/a,100000,should not be imported\n"
        ",https://example.com/blank,200000,blank name skipped\n"
    )
    df = load_and_validate(str(csv_path))
    assert list(df.columns) == ["name", "source_url", "award_ceiling"]
    assert len(df) == 1
    assert df.iloc[0]["name"] == "Grant A"
    assert df.iloc[0]["source_url"] == "https://example.com/a"


def test_load_and_validate_requires_name_column(tmp_path):
    csv_path = tmp_path / "no_name.csv"
    csv_path.write_text("Sponsor,Award Ceiling\nAcme,100000\n")
    with pytest.raises(SystemExit):
        load_and_validate(str(csv_path))


def test_prepare_rows_round_trip(tmp_path):
    csv_path = tmp_path / "scored.csv"
    csv_path.write_text("Name,Award Ceiling\nGrant A,100000\nGrant B,\n")
    df = load_and_validate(str(csv_path))
    rows = prepare_rows(df)
    assert rows == [
        {"name": "Grant A", "award_ceiling": "100000"},
        {"name": "Grant B", "award_ceiling": ""},
    ]
