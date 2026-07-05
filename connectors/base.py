"""Base connector interface and shared types.

Every connector — prebuilt or agent-generated — follows the same contract:
    ingest(config: dict, state: dict, inbox_dir: str) -> dict

* ``config``  – per-connector settings (URLs, usernames, repo names, etc.)
* ``state``   – cursor / checkpoint persisted between runs (e.g. last_id)
* ``inbox_dir`` – directory to write raw fetched data as JSON files
* returns ``new_state`` – updated state dict to persist for the next run

Credentials are NEVER in config.  They are read from environment variables
inside the connector body.  The agent tells the user which env vars to set.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

# ---------------------------------------------------------------------------
# Public types (kept simple – plain dicts so agent-generated code matches)
# ---------------------------------------------------------------------------

Config = Dict[str, Any]
State = Dict[str, Any]


def write_item(inbox_dir: str, source: str, data: Any) -> str:
    """Write *data* as a JSON file into *inbox_dir* and return the path.

    The filename includes a timestamp + uuid so repeated runs never collide.
    """
    Path(inbox_dir).mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    fname = f"{source}-{ts}-{uuid.uuid4().hex[:8]}.json"
    fpath = os.path.join(inbox_dir, fname)
    with open(fpath, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    return fpath


def load_state(state_path: str) -> State:
    """Load persisted state, or return an empty dict."""
    try:
        with open(state_path, encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state_path: str, state: State) -> None:
    """Persist *state* to *state_path* (creates parent dirs)."""
    Path(state_path).parent.mkdir(parents=True, exist_ok=True)
    with open(state_path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, ensure_ascii=False)
