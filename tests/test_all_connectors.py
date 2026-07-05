#!/usr/bin/env python3
"""Test 2a: All 3 prebuilt connectors run with sample config and return data.

Runs web, github, and rss connectors with their sample configs and verifies
each produces raw data files in the inbox directory.
"""

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from connectors.registry import get_connector  # noqa: E402
from connectors.base import load_state, save_state  # noqa: E402


def run_connector(name, config_path, inbox_dir, state_path):
    """Run a connector and return (state, inbox_file_count)."""
    with open(config_path) as fh:
        config = json.load(fh)
    state = load_state(state_path)
    mod = get_connector(name)
    new_state = mod.ingest(config, state, inbox_dir)
    save_state(state_path, new_state)
    return new_state


def test_all_prebuilt_connectors():
    tmpdir = tempfile.mkdtemp(prefix="ow-test-connectors-")
    try:
        inbox_dir = os.path.join(tmpdir, "inbox")
        os.makedirs(inbox_dir, exist_ok=True)

        connectors_config = [
            ("web", "connectors/samples/web.config.json"),
            ("github", "connectors/samples/github.config.json"),
            ("rss", "connectors/samples/rss.config.json"),
        ]

        for conn_name, config_rel in connectors_config:
            config_path = str(PROJECT_ROOT / config_rel)
            state_path = os.path.join(tmpdir, f"{conn_name}.state.json")

            state = run_connector(conn_name, config_path, inbox_dir, state_path)

            # Find the inbox file for this connector
            files = list(Path(inbox_dir).glob(f"{conn_name}-*.json"))
            assert len(files) >= 1, f"{conn_name}: no inbox file produced"

            with open(files[-1]) as fh:
                data = json.load(fh)

            # Verify it has real data
            assert "count" in data, f"{conn_name}: missing 'count' in output"
            assert data["count"] > 0, f"{conn_name}: count is {data['count']}, expected > 0"
            assert "items" in data, f"{conn_name}: missing 'items' in output"
            assert len(data["items"]) > 0, f"{conn_name}: empty items list"

            # Verify state was persisted
            loaded_state = load_state(state_path)
            assert loaded_state.get("runs") == 1, f"{conn_name}: state runs != 1"

            print(f"PASS: {conn_name} connector ran with sample config — {data['count']} items, state={loaded_state}")

        print(f"\nALL PASS: All 3 prebuilt connectors (web, github, rss) run with sample config")
        return True
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    success = test_all_prebuilt_connectors()
    sys.exit(0 if success else 1)
