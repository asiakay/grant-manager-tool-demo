from typing import List, Dict
import json
import logging
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

API_URL = "https://www.grants.gov/grantsws/rest/opportunities/search"


def search_grants(keyword: str, limit: int = 10) -> List[Dict]:
    """Search the grants.gov API for opportunities matching ``keyword``."""
    params = urlencode({"keyword": keyword, "limit": limit})
    url = f"{API_URL}?{params}"
    try:
        with urlopen(url, timeout=10) as resp:
            data = json.load(resp)
    except HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        logging.error("Search API request failed with %s: %s", err.code, body[:200])
        return []
    except URLError as err:
        logging.error("Search API request failed: %s", err)
        return []
    except json.JSONDecodeError as err:
        logging.error("Search API returned invalid JSON: %s", err)
        return []
    return data.get("opportunities", [])
