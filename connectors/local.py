"""Prebuilt connector: local directory ingestion.

Reads files from a local directory and stores their contents as raw JSON items.
This makes local directory ingestion a standard pipeline — identical in
interface and behavior to web/github/rss connectors.

Config fields:
    dir       : str        – directory path to ingest files from (required)
    extensions : list[str] – file extensions to include (default: all files)
    max_files  : int        – maximum number of files to read (default: 100)

Env vars:
    (none — local files are read directly)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

from .base import write_item


def ingest(config: Dict[str, Any], state: Dict[str, Any], inbox_dir: str) -> Dict[str, Any]:
    dir_path = config.get("dir", "")
    if not dir_path:
        raise ValueError("local connector requires 'dir' in config")

    extensions = config.get("extensions", [])
    max_files = int(config.get("max_files", 100))
    root = Path(dir_path)

    if not root.is_dir():
        raise ValueError(f"local connector: '{dir_path}' is not a directory")

    items: list[dict[str, Any]] = []
    seen = set(state.get("seen_files", []))

    for filepath in sorted(root.rglob("*")):
        if len(items) >= max_files:
            break
        if not filepath.is_file():
            continue
        if extensions and filepath.suffix not in extensions:
            continue

        rel_path = str(filepath.relative_to(root))
        # Skip files we've already ingested (cursor-based dedup)
        file_key = f"{rel_path}:{filepath.stat().st_mtime}"
        if file_key in seen:
            continue
        seen.add(file_key)

        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:
            content = f"[read error: {exc}]"

        items.append({
            "path": rel_path,
            "size": filepath.stat().st_size,
            "content": content[:50000],  # cap at 50KB per file
            "extension": filepath.suffix,
        })

    write_item(inbox_dir, "local", {"dir": dir_path, "items": items, "count": len(items)})

    return {
        **state,
        "dir": dir_path,
        "seen_files": list(seen)[-1000:],  # keep last 1000 for dedup
        "runs": state.get("runs", 0) + 1,
    }
