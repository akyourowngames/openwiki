"""Prebuilt connector: GitHub issues & PRs.

Fetches recent issues/PRs from a GitHub repository and stores them as raw JSON.

Config fields:
    repo : str          – "owner/name" (required)
    kind : str          – "issues" | "pulls" | "both" (default "issues")
    per_page : int      – max items per request (default 30, max 100)

Env vars:
    CONNECTOR_GITHUB_TOKEN : GitHub personal access token (required for private
                             repos and higher rate limits; optional for public)
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any, Dict

from .base import write_item


def _fetch_page(url: str, token: str | None) -> Any:
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def ingest(config: Dict[str, Any], state: Dict[str, Any], inbox_dir: str) -> Dict[str, Any]:
    repo = config.get("repo", "")
    if not repo:
        raise ValueError("github connector requires 'repo' in config (e.g. 'owner/name')")

    kind = config.get("kind", "issues")
    per_page = min(int(config.get("per_page", 30)), 100)
    token = os.environ.get("CONNECTOR_GITHUB_TOKEN")

    base = f"https://api.github.com/repos/{repo}"
    items: list[dict[str, Any]] = []

    if kind in ("issues", "both"):
        url = f"{base}/issues?state=all&per_page={per_page}&sort=updated&direction=desc"
        items.extend({"type": "issue", **i} for i in _fetch_page(url, token))

    if kind in ("pulls", "both"):
        url = f"{base}/pulls?state=all&per_page={per_page}&sort=updated&direction=desc"
        items.extend({"type": "pull", **p} for p in _fetch_page(url, token))

    write_item(inbox_dir, "github", {"repo": repo, "items": items, "count": len(items)})

    last_updated = max((i.get("updated_at", "") for i in items), default="")
    return {**state, "repo": repo, "last_updated": last_updated, "runs": state.get("runs", 0) + 1}
