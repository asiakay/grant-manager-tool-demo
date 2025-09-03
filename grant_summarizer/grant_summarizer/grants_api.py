from typing import List, Dict
import json
from urllib.request import urlopen
from urllib.parse import urlencode

API_URL = "https://www.grants.gov/grantsws/rest/opportunities/search"


def search_grants(keyword: str, limit: int = 10) -> List[Dict]:
    """Search the grants.gov API for opportunities matching ``keyword``."""
    params = urlencode({"keyword": keyword, "limit": limit})
    with urlopen(f"{API_URL}?{params}", timeout=10) as resp:
        data = json.load(resp)
    return data.get("opportunities", [])
