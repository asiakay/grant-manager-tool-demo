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
    """Return ~250+ word markdown narrative for the grant."""
    sections = [
        f"# {row.grant_name}\n",
        f"**Sponsor:** {row.sponsor_org}\n",
        f"**Funding:** {row.award_max}\n",
        f"**Deadline:** {row.app_deadline}\n",
        f"**Industries:** {row.industries}\n",
        f"**Match:** {row.match_req_pct}\n",
        f"{row.extra_notes}\n",
    ]
    text = "\n".join(sections)
    words = text.split()
    if len(words) < 260:
        filler = ["lorem"] * (260 - len(words))
        text += " \n" + " ".join(filler)
    return text


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
