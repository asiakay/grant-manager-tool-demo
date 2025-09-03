from pydantic import BaseModel
from typing import Optional

class CleanRow(BaseModel):
    grant_name: str = ""
    sponsor_org: str = ""
    link: Optional[str] = ""
    award_max: Optional[str] = ""
    rfp: Optional[str] = ""
    innovation_execution: Optional[str] = ""
    latest_preparation_start_date: Optional[str] = ""
    app_deadline: Optional[str] = ""
    partners_notes: Optional[str] = ""
    match_req_pct: Optional[str] = ""
    timeline_summary: Optional[str] = ""
    app_process: Optional[str] = ""
    app_package: Optional[str] = ""
    extra_notes: Optional[str] = ""
    industries: Optional[str] = ""
    reimb_pct: Optional[str] = ""
    ceiling: Optional[str] = ""
    milestone_split: Optional[str] = ""
    kpi_targets: Optional[str] = ""
    reporting_schema: Optional[str] = ""
