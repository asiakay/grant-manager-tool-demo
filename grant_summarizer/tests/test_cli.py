from pathlib import Path

from grant_summarizer.cli import main


def test_run_log_created(tmp_path):
    html_file = tmp_path / "sample.html"
    html_file.write_text(
        "Grant opportunity funding up to $5M with applications due Jan 1, 2025"
    )

    outdir = tmp_path / "out"
    main(
        pdf=None,
        url=html_file.as_uri(),
        output_format="json",
        outdir=str(outdir),
        debug=True,
        search=None,
    )

    log_file = outdir / "run.log"
    assert log_file.exists()
    content = log_file.read_text()
    assert "Starting processing" in content
    assert "Source URL" in content
    assert "clean_row.json" in content
