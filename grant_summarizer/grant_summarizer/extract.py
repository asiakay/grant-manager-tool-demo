from pathlib import Path
from typing import Dict
import re
from urllib.request import Request, urlopen
from urllib.parse import urlparse, unquote
import tempfile
from html.parser import HTMLParser

from . import rules

_money_regex = re.compile(r"\$\s?[\d,]+(?:\.\d+)?")
_percent_regex = re.compile(r"\d{1,3}\s?%")
_date_regex = re.compile(
    r"(?:\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s?\d{1,2},\s?\d{4})"
)

WINDOW = 300


def extract_text(pdf_path: str) -> str:
    """Extract text from a PDF using pdfminer; fall back to PyPDF2."""
    from pdfminer.high_level import extract_text as pdfminer_extract

    path = Path(pdf_path)
    try:
        return pdfminer_extract(str(path))
    except Exception:
        try:
            from PyPDF2 import PdfReader  # type: ignore
        except Exception as exc:  # pragma: no cover - PyPDF2 absent
            raise exc
        reader = PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)


class _HTMLStripper(HTMLParser):
    """Utility HTML parser that collects text data."""

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:  # pragma: no cover - trivial
        self._parts.append(data)

    def get_text(self) -> str:
        return " ".join(self._parts)


def _html_to_text(html: str) -> str:
    parser = _HTMLStripper()
    parser.feed(html)
    return parser.get_text()


def extract_text_from_link(link: str, allow_online: bool = False) -> str:
    """Return plain text from a local file or, if allowed, a remote URL."""
    parsed = urlparse(link)
    if parsed.scheme in ("", "file"):
        path = Path(unquote(parsed.path))
        if path.suffix.lower() == ".pdf":
            return extract_text(str(path))
        data = path.read_bytes()
        return _html_to_text(data.decode("utf-8", errors="ignore"))
    if parsed.scheme in ("http", "https"):
        if not allow_online:
            raise ValueError("Remote URLs require allow_online=True")
        req = Request(link, headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(req) as resp:
            data = resp.read()
            content_type = resp.headers.get("content-type", "")
            charset = resp.headers.get_content_charset("utf-8")
        if "pdf" in content_type or link.lower().endswith(".pdf"):
            with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
                tmp.write(data)
                tmp.flush()
                return extract_text(tmp.name)
        text = data.decode(charset, errors="ignore")
        return _html_to_text(text)
    raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")


def find_field_windows(text: str) -> Dict[str, str]:
    """Return +/-300 char windows around keyword hits defined in rules.KEYWORDS."""
    windows: Dict[str, str] = {}
    lowered = text.lower()
    for field, keywords in rules.KEYWORDS.items():
        for kw in keywords:
            idx = lowered.find(kw.lower())
            if idx != -1:
                start = max(0, idx - WINDOW)
                end = min(len(text), idx + len(kw) + WINDOW)
                windows[field] = text[start:end]
                break
    return windows
