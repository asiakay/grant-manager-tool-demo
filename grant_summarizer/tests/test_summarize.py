from grant_summarizer.schema import CleanRow
from grant_summarizer.summarize import brief_bullets, slide_bullets, one_pager_md


def sample_row() -> CleanRow:
    return CleanRow(
        grant_name="Grant",
        sponsor_org="Org",
        award_max="$5M",
        app_deadline="Jan 1, 2025",
        timeline_summary="45 months",
        partners_notes="State agencies",
        industries="Tech",
        match_req_pct="0%",
        reimb_pct="80%",
        reporting_schema="Quarterly",
        extra_notes="Notes",
    )


def test_brief_bullets():
    bullets = brief_bullets(sample_row())
    assert len(bullets) == 5
    assert all(len(b) <= 80 for b in bullets)


def test_slide_bullets():
    bullets = slide_bullets(sample_row())
    assert len(bullets) == 10
    assert all(len(b) <= 100 for b in bullets)


def test_one_pager_md():
    text = one_pager_md(sample_row())
    word_count = len(text.split())
    assert 250 <= word_count <= 400
    for heading in [
        "Funding",
        "Deadline",
        "Period",
        "Eligibility",
        "Industries",
        "Reimbursement",
        "Reporting",
    ]:
        assert f"## {heading}" in text
    assert "lorem" not in text
