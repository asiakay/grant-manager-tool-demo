from typing import List, Dict
import json
import logging
import ssl
import certifi
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

API_URL = "https://www.grants.gov/grantsws/rest/opportunities/search"


def search_grants(keyword: str, limit: int = 10) -> List[Dict]:
    """Search the grants.gov API for opportunities matching ``keyword``."""
    # The API uses the singular "keyword" query parameter.
    params = urlencode({"keyword": keyword, "limit": limit})
    with urlopen(f"{API_URL}?{params}", timeout=10) as resp:
        data = json.load(resp)
    return data.get("opportunities", [])
    payload = {"keywords": keyword, "limit": limit}
    data = json.dumps(payload).encode("utf-8")
    req = Request(API_URL, data=data, headers={"Content-Type": "application/json"}, method="POST")
    context = ssl.create_default_context(cafile=certifi.where())
    try:
        with urlopen(req, timeout=10, context=context) as resp:
            text = resp.read().decode("utf-8")
            status = getattr(resp, "status", 200)
            if status != 200:
                logging.error("Search API returned %s: %s", status, text[:200])
                return []
    except HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        logging.error("Search API request failed with %s: %s", err.code, body[:200])
        return []
    except URLError as err:
        logging.error("Search API request failed: %s", err)
        return []
    return json.loads(text).get("opportunities", [])
