"""Prebuilt connector: web / HTTP fetcher.

Reads one or more URLs and stores the response bodies as raw JSON items.

Config fields:
    urls : list[str]   – URLs to fetch (required)

Env vars:
    CONNECTOR_WEB_TOKEN : optional bearer token for authenticated endpoints
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any, Dict

from .base import write_item


def ingest(config: Dict[str, Any], state: Dict[str, Any], inbox_dir: str) -> Dict[str, Any]:
    urls = config.get("urls", [])
    if not urls:
        raise ValueError("web connector requires 'urls' in config")

    token = os.environ.get("CONNECTOR_WEB_TOKEN")
    fetched = []
    for url in urls:
        req = urllib.request.Request(url)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
            body = resp.read().decode("utf-8")
            # Try to parse as JSON; fall back to raw text wrapper
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                data = {"text": body, "url": url, "content_type": resp.headers.get("Content-Type", "text/plain")}
            item = {"url": url, "data": data}
            fetched.append(item)

    write_item(inbox_dir, "web", {"items": fetched, "count": len(fetched)})

    last_run = state.get("runs", 0) + 1
    return {**state, "runs": last_run, "last_url": urls[-1]}
