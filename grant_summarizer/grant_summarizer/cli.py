from pathlib import Path
import logging
import typer

from .extract import extract_text, extract_text_from_link, find_field_windows
from .normalize import normalize_fields
from .summarize import brief_bullets, one_pager_md, slide_bullets
from .utils import write_json, write_csv


logger = logging.getLogger(__name__)
logger.addHandler(logging.NullHandler())


def main(
    pdf: str = typer.Option(None, help="Path to a grant PDF"),
    url: str = typer.Option(None, help="URL pointing to a grant page or PDF"),
    output_format: str = typer.Option(
        "all", "--format", help="Output format: json, csv, md, or all"
    ),
    outdir: str = "./dist",
    debug: bool = False,
) -> None:
    """CLI entry point for the grant summarizer."""
    provided = [arg for arg in (pdf, url) if arg]
    if not provided:
        raise typer.BadParameter("Provide --pdf or --url")
    if len(provided) > 1:
        raise typer.BadParameter("Use only one of --pdf or --url")

    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)

main
    if debug:
        typer.echo("Debug mode enabled")
        log_file = out / "run.log"
        handler = logging.FileHandler(log_file)
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.setLevel(logging.INFO)
        logger.addHandler(handler)

    try:
        logger.info("Starting processing")

        if search:
            logger.info("Search term: %s", search)
            results = search_grants(search)
            path = out / "search_results.json"
            write_json(results, path)
            logger.info("Wrote %s", path)
            return

        if url:
            logger.info("Source URL: %s", url)
            text = extract_text_from_link(url)
        else:
            logger.info("Source PDF: %s", pdf)
            text = extract_text(pdf)
        windows = find_field_windows(text)
        row = normalize_fields(windows)

        if output_format in ("json", "all"):
            path = out / "clean_row.json"
            write_json(row, path)
            logger.info("Wrote %s", path)
        if output_format in ("csv", "all"):
            path = out / "clean_row.csv"
            write_csv(row, path)
            logger.info("Wrote %s", path)
        if output_format in ("md", "all"):
            path = out / "brief.md"
            path.write_text("\n".join(f"- {b}" for b in brief_bullets(row)) + "\n")
            logger.info("Wrote %s", path)
            path = out / "one_pager.md"
            path.write_text(one_pager_md(row))
            logger.info("Wrote %s", path)
            path = out / "slide_bullets.md"
            path.write_text("\n".join(f"- {b}" for b in slide_bullets(row)) + "\n")
            logger.info("Wrote %s", path)
    finally:
        if handler:
            logger.removeHandler(handler)
            handler.close()


if __name__ == "__main__":  # pragma: no cover
    typer.run(main)
