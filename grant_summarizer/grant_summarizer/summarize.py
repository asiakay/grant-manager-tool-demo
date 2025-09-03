from .schema import CleanRow


def brief_bullets(row: CleanRow) -> list[str]:
    """Return five short bullets summarizing key fields."""
    bullets = [
        f"Grant: {row.grant_name}",
        f"Sponsor: {row.sponsor_org}",
        f"Funding: {row.award_max}",
        f"Deadline: {row.app_deadline}",
        f"Industries: {row.industries}",
    ]
    return [b[:80] for b in bullets[:5]]


def one_pager_md(row: CleanRow) -> str:
    """Return ~250–400 word markdown narrative for the grant."""

    sections: list[str] = [f"# {row.grant_name}", f"**Sponsor:** {row.sponsor_org}"]

    def add(title: str, body: str) -> None:
        sections.append(f"## {title}\n{body}")

    if row.award_max or row.match_req_pct:
        parts: list[str] = []
        if row.award_max:
            parts.append(
                f"As funding up to {row.award_max} is available, applicants can design "
                "ambitious projects that address pressing community or industry needs."
            )
        else:
            parts.append(
                "The program offers financial support for ambitious projects that address "
                "pressing community or industry needs."
            )
        if row.match_req_pct:
            parts.append(
                f"A match of {row.match_req_pct} demonstrates commitment, and proposals "
                "should justify the requested amount with clear outcomes."
            )
        parts.append(
            "Budgets should illustrate responsible spending and long-term impact. "
            "Reviewers appreciate plans that leverage diverse revenue sources and "
            "minimize risk."
        )
        add("Funding", " ".join(parts))

    if row.app_deadline:
        add(
            "Deadline",
            (
                f"Applications are due by {row.app_deadline}, and late submissions are "
                "typically not accepted. Prospective applicants should establish internal "
                "timelines for drafting, review, and authorization to ensure all materials "
                "are uploaded before the cutoff. Early preparation reduces last-minute "
                "errors and allows time for addressing technical issues. Maintaining a "
                "checklist of required attachments helps teams stay organized."
            ),
        )

    if row.timeline_summary:
        add(
            "Period",
            (
                f"The anticipated period of performance spans {row.timeline_summary}, "
                "providing ample opportunity for project execution and evaluation. "
                "Applicants should schedule milestones that demonstrate steady progress "
                "and integrate planning time where necessary. Clear timelines help "
                "funders assess feasibility and ensure resources are deployed efficiently "
                "throughout the award. Regular reviews keep projects aligned with "
                "strategic objectives."
            ),
        )

    if row.partners_notes:
        add(
            "Eligibility",
            (
                f"Eligibility typically includes {row.partners_notes}. Organizations must "
                "verify their legal status and capacity to manage federal funds. "
                "Demonstrated experience with similar initiatives strengthens applications, "
                "and partnerships can broaden impact. Applicants should consult the "
                "solicitation for complete eligibility details and confirm there are no "
                "statutory exclusions. Early engagement with potential partners can clarify "
                "roles and responsibilities."
            ),
        )

    if row.industries:
        add(
            "Industries",
            (
                f"Target industries for this opportunity include {row.industries}. "
                "Proposals should articulate the specific market gaps the project addresses "
                "and how industry stakeholders will benefit. Aligning activities with "
                "sector priorities strengthens the case for funding and demonstrates "
                "awareness of broader economic trends influencing the field. Collaboration "
                "with trade groups or consortia can further amplify outcomes."
            ),
        )

    if row.reimb_pct:
        add(
            "Reimbursement",
            (
                f"Costs are reimbursed at a rate of {row.reimb_pct}, meaning organizations "
                "front expenses and request repayment. Applicants should maintain "
                "meticulous financial records and use approved accounting systems to "
                "document costs. Prompt invoicing accelerates cash flow, and understanding "
                "allowability rules prevents disallowed charges that could impact budgets. "
                "Clear communication with the grant officer helps resolve questions "
                "quickly."
            ),
        )

    if row.reporting_schema:
        add(
            "Reporting",
            (
                f"Reporting requirements follow a {row.reporting_schema} schedule. Awardees "
                "must submit timely updates that summarize activities, expenditures, and "
                "measurable outcomes. Good reporting demonstrates accountability and "
                "informs future policy decisions. Establishing internal review processes and "
                "assigning responsibility for data collection will make compliance smoother "
                "and ensure narratives remain consistent. Detailed records also support "
                "sustainability planning beyond the grant period."
            ),
        )

    return "\n\n".join(sections) + "\n"


def slide_bullets(row: CleanRow) -> list[str]:
    """Return ten bullets suitable for slide decks."""
    bullets = [
        f"{row.grant_name} overview",
        f"Sponsor: {row.sponsor_org}",
        f"Funding up to {row.award_max}",
        f"Deadline {row.app_deadline}",
        f"Industries: {row.industries}",
        f"Match: {row.match_req_pct}",
        f"Timeline: {row.timeline_summary}",
        f"Reimb: {row.reimb_pct}",
        f"Reporting: {row.reporting_schema}",
        f"Notes: {row.extra_notes}",
    ]
    return [b[:100] for b in bullets[:10]]
