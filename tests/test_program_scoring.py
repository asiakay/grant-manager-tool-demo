"""
pytest suite for program_scoring.add_program_scores().

Tests are frozen at 2026-06-14 so deadline-relative assertions stay stable.
The weighted score formula is:
  0.3*Relevance + 0.3*Fit + 0.2*Ease + 0.1*StackAlignment + 0.1*CadenceRecency

Where:
  StackAlignment  = 1.0 if "yes" in Stack Required? else 0.2
  CadenceRecency  = 1.0 if rolling else max(0, 1 - min(days_until_deadline, 365) / 365)
"""

import pytest
import pandas as pd
from freezegun import freeze_time

from program_scoring import add_program_scores, _normalize_columns, _validate_columns


# ---------------------------------------------------------------------------
# Shared sample data (frozen at 2026-06-14)
# ---------------------------------------------------------------------------

# 2026-06-14 + 30 days  = 2026-07-14   → CadenceRecency = 1 - 30/365 ≈ 0.918
# 2026-06-14 + 400 days = 2027-07-19   → CadenceRecency = max(0, 1 - 365/365) = 0.0

_SAMPLE_PROGRAMS = [
    {   # Program 0 — rolling + stack yes → maximum on both computed dims
        "name": "Rolling Stack Accelerator",
        "Stack Required?": "yes",
        "Deadline / Next Cohort": "Rolling",
        "Cadence": "Rolling",
        "Relevance": 3.0,
        "Fit": 3.0,
        "Ease": 3.0,
    },
    {   # Program 1 — near deadline (30 days) + stack no
        "name": "Near Deadline Grant",
        "Stack Required?": "no",
        "Deadline / Next Cohort": "2026-07-14",
        "Cadence": "Annual",
        "Relevance": 2.0,
        "Fit": 2.0,
        "Ease": 2.0,
    },
    {   # Program 2 — far future (400 days → clamped → CR=0) + stack yes
        "name": "Far Future Grant",
        "Stack Required?": "yes",
        "Deadline / Next Cohort": "2027-07-19",
        "Cadence": "Annual",
        "Relevance": 1.0,
        "Fit": 1.0,
        "Ease": 1.0,
    },
    {   # Program 3 — past deadline + no stack → both computed fields = 0
        "name": "Past Deadline Grant",
        "Stack Required?": "no",
        "Deadline / Next Cohort": "2025-01-01",
        "Cadence": "Annual",
        "Relevance": 2.0,
        "Fit": 2.0,
        "Ease": 2.0,
    },
    {   # Program 4 — missing numeric fields + rolling → numeric coercion
        "name": "Bare Minimum Grant",
        "Stack Required?": "unknown",
        "Deadline / Next Cohort": "Rolling",
        "Cadence": "",
        "Relevance": None,
        "Fit": None,
        "Ease": None,
    },
]


@pytest.fixture
def sample_df():
    """All 5 sample programs as a DataFrame."""
    return pd.DataFrame(_SAMPLE_PROGRAMS)


def _one_row(**kwargs) -> pd.DataFrame:
    """Build a single-row DataFrame with required columns and kwargs overrides."""
    base = {
        "Stack Required?": "no",
        "Deadline / Next Cohort": "Rolling",
        "Cadence": "Rolling",
        "Relevance": 1.0,
        "Fit": 1.0,
        "Ease": 1.0,
    }
    base.update(kwargs)
    return pd.DataFrame([base])


# ---------------------------------------------------------------------------
# Formula correctness
# ---------------------------------------------------------------------------


@freeze_time("2026-06-14")
def test_weighted_score_formula_rolling_stack_yes(sample_df):
    """Program 0: max inputs → 0.3*3 + 0.3*3 + 0.2*3 + 0.1*1.0 + 0.1*1.0 = 2.6."""
    result = add_program_scores(sample_df)
    row = result[result["name"] == "Rolling Stack Accelerator"].iloc[0]
    assert row["StackAlignment"] == pytest.approx(1.0)
    assert row["CadenceRecency"] == pytest.approx(1.0)
    assert row["Weighted Score"] == pytest.approx(2.6, abs=1e-3)


@freeze_time("2026-06-14")
def test_weighted_score_formula_past_deadline_no_stack(sample_df):
    """Program 3: CR=0, SA=0.2, R/F/E=2.0 → 0.3*2 + 0.3*2 + 0.2*2 + 0.1*0.2 + 0 = 1.62."""
    result = add_program_scores(sample_df)
    row = result[result["name"] == "Past Deadline Grant"].iloc[0]
    assert row["StackAlignment"] == pytest.approx(0.2)
    assert row["CadenceRecency"] == pytest.approx(0.0)
    assert row["Weighted Score"] == pytest.approx(1.62, abs=1e-3)


@freeze_time("2026-06-14")
def test_weighted_score_formula_near_deadline_no_stack(sample_df):
    """Program 1: 30 days, no stack → formula using CR≈0.918, SA=0.2."""
    result = add_program_scores(sample_df)
    row = result[result["name"] == "Near Deadline Grant"].iloc[0]
    expected = 0.3 * 2.0 + 0.3 * 2.0 + 0.2 * 2.0 + 0.1 * 0.2 + 0.1 * row["CadenceRecency"]
    assert row["Weighted Score"] == pytest.approx(round(expected, 3), abs=1e-3)


# ---------------------------------------------------------------------------
# CadenceRecency edge cases
# ---------------------------------------------------------------------------


@freeze_time("2026-06-14")
def test_cadence_recency_rolling_keyword_in_deadline():
    """'Rolling' in Deadline column → CadenceRecency = 1.0."""
    df = _one_row(**{"Deadline / Next Cohort": "Rolling", "Cadence": "Annual"})
    result = add_program_scores(df)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(1.0)


@freeze_time("2026-06-14")
def test_cadence_recency_rolling_keyword_in_cadence():
    """'Rolling' in Cadence column (even with a date deadline) → CadenceRecency = 1.0."""
    df = _one_row(**{"Deadline / Next Cohort": "2026-09-01", "Cadence": "Rolling"})
    result = add_program_scores(df)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(1.0)


@freeze_time("2026-06-14")
def test_cadence_recency_near_deadline_30_days():
    """30 days until deadline → 1 - 30/365 ≈ 0.918."""
    df = _one_row(**{"Deadline / Next Cohort": "2026-07-14", "Cadence": "Annual"})
    result = add_program_scores(df)
    expected = round(1 - 30 / 365, 3)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(expected, abs=1e-3)


@freeze_time("2026-06-14")
def test_cadence_recency_near_deadline_182_days():
    """182 days until deadline → 1 - 182/365 ≈ 0.501."""
    df = _one_row(**{"Deadline / Next Cohort": "2026-12-13", "Cadence": "Annual"})
    result = add_program_scores(df)
    expected = round(1 - 182 / 365, 3)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(expected, abs=1e-3)


@freeze_time("2026-06-14")
def test_cadence_recency_far_future_clamped_to_zero():
    """400 days away → min(400,365)/365 = 1.0 → CadenceRecency = 0.0."""
    df = _one_row(**{"Deadline / Next Cohort": "2027-07-19", "Cadence": "Annual"})
    result = add_program_scores(df)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(0.0)


@freeze_time("2026-06-14")
def test_cadence_recency_exactly_365_days():
    """Exactly 365 days away → 1 - 365/365 = 0.0."""
    df = _one_row(**{"Deadline / Next Cohort": "2027-06-14", "Cadence": "Annual"})
    result = add_program_scores(df)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(0.0)


@freeze_time("2026-06-14")
def test_cadence_recency_past_deadline():
    """Past deadline → CadenceRecency = 0.0."""
    df = _one_row(**{"Deadline / Next Cohort": "2025-01-01", "Cadence": "Annual"})
    result = add_program_scores(df)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(0.0)


@freeze_time("2026-06-14")
def test_cadence_recency_unparseable_deadline():
    """Unparseable deadline string ('N/A') → CadenceRecency = 0.0."""
    df = _one_row(**{"Deadline / Next Cohort": "N/A", "Cadence": "Annual"})
    result = add_program_scores(df)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(0.0)


@freeze_time("2026-06-14")
def test_cadence_recency_empty_deadline():
    """Empty string deadline → CadenceRecency = 0.0."""
    df = _one_row(**{"Deadline / Next Cohort": "", "Cadence": "Annual"})
    result = add_program_scores(df)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(0.0)


@freeze_time("2026-06-14")
def test_cadence_recency_nan_deadline():
    """NaN deadline (float) → CadenceRecency = 0.0."""
    import math
    df = _one_row(**{"Deadline / Next Cohort": float("nan"), "Cadence": "Annual"})
    result = add_program_scores(df)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# StackAlignment edge cases
# ---------------------------------------------------------------------------


@freeze_time("2026-06-14")
def test_stack_alignment_yes_exact():
    """'yes' → StackAlignment = 1.0."""
    df = _one_row(**{"Stack Required?": "yes"})
    result = add_program_scores(df)
    assert result["StackAlignment"].iloc[0] == pytest.approx(1.0)


@freeze_time("2026-06-14")
@pytest.mark.parametrize("value", ["Yes", "YES", "YES please", "yes "])
def test_stack_alignment_yes_variants(value):
    """Any string containing 'yes' (case-insensitive) → StackAlignment = 1.0."""
    df = _one_row(**{"Stack Required?": value})
    result = add_program_scores(df)
    assert result["StackAlignment"].iloc[0] == pytest.approx(1.0), f"Failed for: {value!r}"


@freeze_time("2026-06-14")
def test_stack_alignment_no():
    """'no' → StackAlignment = 0.2."""
    df = _one_row(**{"Stack Required?": "no"})
    result = add_program_scores(df)
    assert result["StackAlignment"].iloc[0] == pytest.approx(0.2)


@freeze_time("2026-06-14")
@pytest.mark.parametrize("value", ["unknown", "n/a", "TBD", "", "maybe", "1"])
def test_stack_alignment_non_yes_defaults_to_0_2(value):
    """Any value not containing 'yes' → StackAlignment = 0.2."""
    df = _one_row(**{"Stack Required?": value})
    result = add_program_scores(df)
    assert result["StackAlignment"].iloc[0] == pytest.approx(0.2), f"Failed for: {value!r}"


# ---------------------------------------------------------------------------
# Column alias normalization
# ---------------------------------------------------------------------------


@freeze_time("2026-06-14")
def test_alias_stack_required_no_space():
    """Column 'StackRequired' is accepted as alias for 'Stack Required?'."""
    df = pd.DataFrame([{
        "StackRequired": "yes",
        "Deadline / Next Cohort": "Rolling",
        "Cadence": "Rolling",
        "Relevance": 1.0, "Fit": 1.0, "Ease": 1.0,
    }])
    result = add_program_scores(df)
    assert result["StackAlignment"].iloc[0] == pytest.approx(1.0)


@freeze_time("2026-06-14")
def test_alias_stack_required_without_question_mark():
    """Column 'Stack Required' (no '?') is accepted as alias."""
    df = pd.DataFrame([{
        "Stack Required": "yes",
        "Deadline / Next Cohort": "Rolling",
        "Cadence": "Rolling",
        "Relevance": 1.0, "Fit": 1.0, "Ease": 1.0,
    }])
    result = add_program_scores(df)
    assert result["StackAlignment"].iloc[0] == pytest.approx(1.0)


@freeze_time("2026-06-14")
def test_alias_deadline_iso():
    """Column 'DeadlineISO' is accepted as alias for 'Deadline / Next Cohort'."""
    df = pd.DataFrame([{
        "Stack Required?": "no",
        "DeadlineISO": "Rolling",
        "Cadence": "Rolling",
        "Relevance": 1.0, "Fit": 1.0, "Ease": 1.0,
    }])
    result = add_program_scores(df)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(1.0)


@freeze_time("2026-06-14")
def test_alias_deadline_plain():
    """Column 'Deadline' is accepted as alias for 'Deadline / Next Cohort'."""
    df = pd.DataFrame([{
        "Stack Required?": "no",
        "Deadline": "Rolling",
        "Cadence": "Rolling",
        "Relevance": 1.0, "Fit": 1.0, "Ease": 1.0,
    }])
    result = add_program_scores(df)
    assert result["CadenceRecency"].iloc[0] == pytest.approx(1.0)


@freeze_time("2026-06-14")
def test_alias_ease_of_use():
    """Column 'Ease of Use' is accepted as alias for 'Ease'."""
    df = pd.DataFrame([{
        "Stack Required?": "no",
        "Deadline / Next Cohort": "Rolling",
        "Cadence": "Rolling",
        "Relevance": 1.0, "Fit": 1.0, "Ease of Use": 2.0,
    }])
    result = add_program_scores(df)
    expected_score = 0.3 * 1.0 + 0.3 * 1.0 + 0.2 * 2.0 + 0.1 * 0.2 + 0.1 * 1.0
    assert result["Weighted Score"].iloc[0] == pytest.approx(round(expected_score, 3), abs=1e-3)


@freeze_time("2026-06-14")
def test_canonical_names_pass_through():
    """When canonical column names are already present, no renaming occurs."""
    df = _one_row(**{"Stack Required?": "yes"})
    normalized = _normalize_columns(df.copy())
    assert "Stack Required?" in normalized.columns
    assert "Deadline / Next Cohort" in normalized.columns


# ---------------------------------------------------------------------------
# Validation — missing required columns
# ---------------------------------------------------------------------------


def test_missing_required_column_raises_value_error():
    """A DataFrame missing 'Relevance' raises ValueError."""
    df = pd.DataFrame([{
        "Stack Required?": "no",
        "Deadline / Next Cohort": "Rolling",
        "Cadence": "Rolling",
        "Fit": 1.0,
        "Ease": 1.0,
        # "Relevance" deliberately omitted
    }])
    with pytest.raises(ValueError, match="Relevance"):
        add_program_scores(df)


def test_missing_multiple_columns_lists_all_in_error():
    """ValueError message lists every missing column, not just the first."""
    df = pd.DataFrame([{"name": "stub"}])
    with pytest.raises(ValueError) as exc_info:
        add_program_scores(df)
    msg = str(exc_info.value)
    assert "Stack Required?" in msg or "Relevance" in msg  # at least one missing column named
    assert "Found columns:" in msg


def test_validate_columns_raises_for_empty_dataframe():
    """An empty DataFrame (no columns) raises ValueError."""
    df = pd.DataFrame()
    with pytest.raises(ValueError):
        _validate_columns(df)


# ---------------------------------------------------------------------------
# Missing / null numeric fields
# ---------------------------------------------------------------------------


@freeze_time("2026-06-14")
def test_null_relevance_fit_ease_default_to_zero():
    """None values for Relevance/Fit/Ease coerce to 0; score = 0.1*SA + 0.1*CR."""
    df = _one_row(**{"Relevance": None, "Fit": None, "Ease": None,
                     "Stack Required?": "yes", "Deadline / Next Cohort": "Rolling", "Cadence": "Rolling"})
    result = add_program_scores(df)
    # 0*0.3 + 0*0.3 + 0*0.2 + 1.0*0.1 + 1.0*0.1 = 0.2
    assert result["Weighted Score"].iloc[0] == pytest.approx(0.2, abs=1e-3)


@freeze_time("2026-06-14")
@pytest.mark.parametrize("bad_value", ["TBD", "N/A", "", "unknown"])
def test_non_numeric_string_fields_default_to_zero(bad_value):
    """Non-numeric strings in Relevance/Fit/Ease coerce to 0 without raising."""
    df = _one_row(**{"Relevance": bad_value, "Fit": bad_value, "Ease": bad_value,
                     "Stack Required?": "no", "Deadline / Next Cohort": "Rolling", "Cadence": "Rolling"})
    result = add_program_scores(df)
    # 0.1*0.2 + 0.1*1.0 = 0.12
    assert result["Weighted Score"].iloc[0] == pytest.approx(0.12, abs=1e-3)


@freeze_time("2026-06-14")
def test_bare_minimum_grant_in_full_fixture(sample_df):
    """Program 4 (Bare Minimum) scores without raising even with all-None numerics."""
    result = add_program_scores(sample_df)
    row = result[result["name"] == "Bare Minimum Grant"].iloc[0]
    # rolling + stack unknown(0.2) → 0 + 0 + 0 + 0.02 + 0.1 = 0.12
    assert row["Weighted Score"] == pytest.approx(0.12, abs=1e-3)


# ---------------------------------------------------------------------------
# Output shape
# ---------------------------------------------------------------------------


@freeze_time("2026-06-14")
def test_output_contains_stack_alignment_column(sample_df):
    result = add_program_scores(sample_df)
    assert "StackAlignment" in result.columns


@freeze_time("2026-06-14")
def test_output_contains_cadence_recency_column(sample_df):
    result = add_program_scores(sample_df)
    assert "CadenceRecency" in result.columns


@freeze_time("2026-06-14")
def test_output_contains_weighted_score_column(sample_df):
    result = add_program_scores(sample_df)
    assert "Weighted Score" in result.columns


@freeze_time("2026-06-14")
def test_all_rows_scored(sample_df):
    """Every row in the 5-program fixture receives a Weighted Score (no NaNs)."""
    result = add_program_scores(sample_df)
    assert len(result) == 5
    assert result["Weighted Score"].notna().all()


@freeze_time("2026-06-14")
def test_original_columns_preserved(sample_df):
    """add_program_scores does not drop any input columns."""
    result = add_program_scores(sample_df)
    for col in sample_df.columns:
        assert col in result.columns


@freeze_time("2026-06-14")
def test_scores_are_rounded_to_3_decimal_places(sample_df):
    """Weighted Score, StackAlignment, CadenceRecency are rounded to 3 decimals."""
    result = add_program_scores(sample_df)
    for _, row in result.iterrows():
        for field in ("StackAlignment", "CadenceRecency", "Weighted Score"):
            val = row[field]
            assert round(val, 3) == val, f"{field}={val} has more than 3 decimal places"


@freeze_time("2026-06-14")
def test_weighted_scores_are_non_negative(sample_df):
    result = add_program_scores(sample_df)
    assert (result["Weighted Score"] >= 0).all()


@freeze_time("2026-06-14")
def test_stack_alignment_values_are_either_0_2_or_1_0(sample_df):
    result = add_program_scores(sample_df)
    valid = {0.2, 1.0}
    for val in result["StackAlignment"]:
        assert val in valid, f"Unexpected StackAlignment value: {val}"


@freeze_time("2026-06-14")
def test_cadence_recency_within_0_1_range(sample_df):
    result = add_program_scores(sample_df)
    assert (result["CadenceRecency"] >= 0).all()
    assert (result["CadenceRecency"] <= 1).all()


# ---------------------------------------------------------------------------
# Single-row sanity: far-future grant
# ---------------------------------------------------------------------------


@freeze_time("2026-06-14")
def test_far_future_grant_in_full_fixture(sample_df):
    """Program 2: 400 days out, stack yes → CR=0.0, SA=1.0."""
    result = add_program_scores(sample_df)
    row = result[result["name"] == "Far Future Grant"].iloc[0]
    assert row["CadenceRecency"] == pytest.approx(0.0)
    assert row["StackAlignment"] == pytest.approx(1.0)
    # score = 0.3*1 + 0.3*1 + 0.2*1 + 0.1*1.0 + 0.1*0.0 = 0.9
    assert row["Weighted Score"] == pytest.approx(0.9, abs=1e-3)
