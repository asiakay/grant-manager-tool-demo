from io import BytesIO
from unittest.mock import patch
import json

from grant_summarizer.grants_api import search_grants


def test_search_grants():
    fake_json = {"opportunities": [{"id": 1, "title": "Test"}]}
    fake_bytes = json.dumps(fake_json).encode("utf-8")
    with patch("grant_summarizer.grants_api.urlopen", return_value=BytesIO(fake_bytes)) as mock_urlopen:
        results = search_grants("water", limit=1)
    assert results == fake_json["opportunities"]
    mock_urlopen.assert_called_once()
