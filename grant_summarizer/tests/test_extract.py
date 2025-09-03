import pytest

from grant_summarizer.extract import (
    _money_regex,
    _percent_regex,
    _date_regex,
    find_field_windows,
    extract_text_from_link,
)


def test_regex_patterns():
    text = "$5,000 represents 20% due January 1, 2025"
    assert _money_regex.search(text).group() == "$5,000"
    assert _percent_regex.search(text).group() == "20%"
    assert _date_regex.search(text).group() == "January 1, 2025"
    assert _money_regex.search("no money here") is None


def test_window_extraction():
    sample = "Funding available up to $5M with applications due Dec 1, 2025."
    windows = find_field_windows(sample)
    assert "award_max" in windows
    assert "app_deadline" in windows
    assert "Funding" in windows["award_max"]
    assert "Dec" in windows["app_deadline"]
    for w in windows.values():
        assert len(w) <= 600


def test_extract_text_from_link_html(tmp_path):
    html_file = tmp_path / "sample.html"
    html_file.write_text("<html><body>Grant Program Deadline Jan 1 2025</body></html>")
    text = extract_text_from_link(html_file.as_uri())
    assert "Grant Program" in text
    assert "Jan" in text


def test_extract_text_from_link_pdf(tmp_path):
    pdf_file = tmp_path / "sample.pdf"
    pdf_bytes = ("%PDF-1.1\n"
                 "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
                 "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
                 "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>endobj\n"
                 "4 0 obj<</Length 44>>stream\nBT/F1 24 Tf 100 100 Td(Hello PDF) Tj ET\nendstream endobj\n"
                 "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
                 "xref\n0 6\n0000000000 65535 f\n0000000010 00000 n\n0000000061 00000 n\n0000000112 00000 n\n0000000266 00000 n\n0000000350 00000 n\n"
                 "trailer<</Root 1 0 R/Size 6>>\nstartxref\n417\n%%EOF")
    pdf_file.write_bytes(pdf_bytes.encode("latin1"))
    text = extract_text_from_link(pdf_file.as_uri())
    assert isinstance(text, str)


def test_extract_text_from_link_disallows_http():
    with pytest.raises(ValueError):
        extract_text_from_link("http://example.com")
