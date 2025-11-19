from typing import List, Dict
import json
import logging
import ssl
import certifi
from urllib.request import urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

API_URL = "https://www.grants.gov/grantsws/rest/opportunities/search"


def search_grants(keyword: str, limit: int = 10) -> List[Dict]:
    """Search the grants.gov API for opportunities matching ``keyword``."""
    # The API uses the singular "keyword" query parameter.
    params = urlencode({"keyword": keyword, "limit": limit})
    try:
        with urlopen(f"{API_URL}?{params}", timeout=10) as resp:
            data = json.load(resp)
    except HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        logging.error("Search API request failed with %s: %s", err.code, body[:200])
        return []
    except URLError as err:
        logging.error("Search API request failed: %s", err)
        return []
    return data.get("opportunities", [])
