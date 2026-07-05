"""Prebuilt connector: RSS / Atom feed reader.

Parses one or more RSS/Atom feeds and stores entries as raw JSON.

Config fields:
    feeds : list[str]   – feed URLs (required)
    limit  : int         – max items per feed (default 20)

Env vars:
    (none — RSS is public)
"""

from __future__ import annotations

import os
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Dict

from .base import write_item


def _parse_feed(xml_text: str, feed_url: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_text)
    entries: list[dict[str, Any]] = []

    # RSS 2.0
    if root.tag == "rss":
        for item in root.findall(".//item"):
            def _text(tag: str) -> str:
                el = item.findtext(tag)
                return el.strip() if el else ""
            entries.append({
                "title": _text("title"),
                "link": _text("link"),
                "description": _text("description"),
                "pub_date": _text("pubDate"),
                "guid": _text("guid"),
            })

    # Atom
    elif root.tag == "{http://www.w3.org/2005/Atom}feed":
        ns = {"a": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("a:entry", ns):
            def _atext(tag: str) -> str:
                el = entry.findtext(f"a:{tag}", namespaces=ns)
                return el.strip() if el else ""
            link_el = entry.find("a:link", namespaces=ns)
            link = link_el.get("href", "") if link_el is not None else ""
            entries.append({
                "title": _atext("title"),
                "link": link,
                "summary": _atext("summary"),
                "published": _atext("published"),
                "id": _atext("id"),
            })

    return entries


def ingest(config: Dict[str, Any], state: Dict[str, Any], inbox_dir: str) -> Dict[str, Any]:
    feeds = config.get("feeds", [])
    if not feeds:
        raise ValueError("rss connector requires 'feeds' in config")
    limit = int(config.get("limit", 20))

    all_entries: list[dict[str, Any]] = []
    for feed_url in feeds:
        req = urllib.request.Request(feed_url)
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
            xml_text = resp.read().decode("utf-8")
        entries = _parse_feed(xml_text, feed_url)[:limit]
        for e in entries:
            e["feed_url"] = feed_url
        all_entries.extend(entries)

    write_item(inbox_dir, "rss", {"items": all_entries, "count": len(all_entries)})

    last_seen = max((e.get("pub_date") or e.get("published") or "" for e in all_entries), default="")
    return {**state, "feeds": feeds, "last_seen": last_seen, "runs": state.get("runs", 0) + 1}
