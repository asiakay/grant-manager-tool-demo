from pathlib import Path
import typer

from .extract import extract_text, extract_text_from_link, find_field_windows
from .normalize import normalize_fields
from .summarize import brief_bullets, one_pager_md, slide_bullets
from .utils import write_json, write_csv
from .grants_api import search_grants


def main(
    pdf: str = typer.Option(None, help="Path to a grant PDF"),
    url: str = typer.Option(None, help="URL pointing to a grant page or PDF"),
    output_format: str = typer.Option("all", "--format", help="Output format: json, csv, md, or all"),
    outdir: str = "./dist",
    debug: bool = False,
    search: str = typer.Option(None, help="Keyword to search on grants.gov"),
) -> None:
    """CLI entry point for the grant summarizer."""
    provided = [arg for arg in (pdf, url, search) if arg]
    if not provided:
        raise typer.BadParameter("Provide --pdf, --url, or --search")
    if len(provided) > 1:
        raise typer.BadParameter("Use only one of --pdf, --url, or --search")

    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)

    if search:
        results = search_grants(search)
        write_json(results, out / "search_results.json")
        return

    if debug:
        typer.echo("Debug mode enabled")

    if url:
        text = extract_text_from_link(url)
    else:
        text = extract_text(pdf)
    windows = find_field_windows(text)
    row = normalize_fields(windows)

    if output_format in ("json", "all"):
        write_json(row, out / "clean_row.json")
    if output_format in ("csv", "all"):
        write_csv(row, out / "clean_row.csv")
    if output_format in ("md", "all"):
        (out / "brief.md").write_text("\n".join(f"- {b}" for b in brief_bullets(row)) + "\n")
        (out / "one_pager.md").write_text(one_pager_md(row))
        (out / "slide_bullets.md").write_text(
            "\n".join(f"- {b}" for b in slide_bullets(row)) + "\n"
        )


if __name__ == "__main__":  # pragma: no cover
    typer.run(main)
