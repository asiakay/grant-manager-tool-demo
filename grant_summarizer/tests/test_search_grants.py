import logging
import sys
from pathlib import Path
from unittest.mock import patch

# Ensure repository root is on the import path to load search_grants.py
sys.path.append(str(Path(__file__).resolve().parents[2]))

from search_grants import _get_json, search_grants as do_search, fetch_detail, SEARCH_URL


def test_get_json_adds_params_and_headers():
    params = {"a": "1"}
    captured = {}

    class FakeResponse:
        status = 200

        def read(self):
            return b"{}"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    def fake_urlopen(req, context=None):
        captured["req"] = req
        return FakeResponse()

    with patch("urllib.request.urlopen", fake_urlopen):
        _get_json(SEARCH_URL, params)

    req = captured["req"]
    assert req.headers["Accept"] == "application/json"
    assert req.full_url.endswith("?a=1")


def test_search_grants_success():
    fake = {"opportunities": [{"id": 1}]}
    with patch("search_grants._post_json", return_value=fake) as mock_post:
        results = do_search("water", {"f": "v"})
    assert results == fake["opportunities"]
    mock_post.assert_called_once_with(
        SEARCH_URL, {"keywords": "water", "limit": "20", "f": "v"}, debug=False
    )


def test_search_grants_failure(caplog):
    with patch("search_grants._post_json", side_effect=RuntimeError("boom")):
        with caplog.at_level(logging.ERROR):
            results = do_search("x", {})
    assert results == []
    assert "Search request failed" in caplog.text


def test_fetch_detail_failure(caplog):
    with patch("search_grants._get_json", side_effect=RuntimeError("bad")):
        with caplog.at_level(logging.ERROR):
            result = fetch_detail("123")
    assert result == {}
    assert "Detail request for 123 failed" in caplog.text
