from .schema import CleanRow


def _clean(value: str | None) -> str:
    return value.strip() if value else ""


def normalize_fields(windows: dict[str, str]) -> CleanRow:
    """Map extracted windows to CleanRow fields, defaulting to empty strings."""
    return CleanRow(
        grant_name=_clean(windows.get("grant_name")),
        sponsor_org=_clean(windows.get("sponsor_org")),
        link=_clean(windows.get("link")),
        award_max=_clean(windows.get("award_max")),
        rfp=_clean(windows.get("rfp")),
        innovation_execution=_clean(windows.get("innovation_execution")),
        latest_preparation_start_date=_clean(windows.get("latest_preparation_start_date")),
        app_deadline=_clean(windows.get("app_deadline")),
        partners_notes=_clean(windows.get("partners_notes")),
        match_req_pct=_clean(windows.get("match_req_pct")),
        timeline_summary=_clean(windows.get("timeline_summary")),
        app_process=_clean(windows.get("app_process")),
        app_package=_clean(windows.get("app_package")),
        extra_notes=_clean(windows.get("extra_notes")),
        industries=_clean(windows.get("industries")),
        reimb_pct=_clean(windows.get("reimb_pct")),
        ceiling=_clean(windows.get("ceiling")),
        milestone_split=_clean(windows.get("milestone_split")),
        kpi_targets=_clean(windows.get("kpi_targets")),
        reporting_schema=_clean(windows.get("reporting_schema")),
    )
