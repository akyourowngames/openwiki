#!/usr/bin/env python3
"""Test 1: Agent-generated connector runs and returns data with a mock config.

Simulates what the agent does: writes a custom Python connector script,
then invokes it with a config and verifies it produces raw data in the inbox.
"""

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

# Ensure project root is importable
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from connectors.base import load_state, save_state  # noqa: E402


def test_agent_generated_connector():
    """Write a custom connector (like the agent would), then run it."""
    tmpdir = tempfile.mkdtemp(prefix="ow-test-agent-")
    try:
        # --- Simulate agent writing a connector ---
        connector_dir = Path(tmpdir) / "connectors" / "mockdata"
        connector_dir.mkdir(parents=True)
        (connector_dir / "__init__.py").write_text("from .connector import ingest\n")

        # The connector code the agent would generate
        connector_code = '''\
"""Custom connector: mockdata — generates fake items for testing."""
import os
import json
from typing import Any, Dict

from connectors.base import write_item


def ingest(config: Dict[str, Any], state: Dict[str, Any], inbox_dir: str) -> Dict[str, Any]:
    count = config.get("count", 3)
    source = config.get("source", "mock")
    token = os.environ.get("CONNECTOR_MOCKDATA_TOKEN")

    items = []
    for i in range(count):
        items.append({
            "id": f"{source}-{i}",
            "title": f"Mock item {i} from {source}",
            "body": f"This is mock item number {i}.",
            "has_token": token is not None,
        })

    write_item(inbox_dir, "mockdata", {"items": items, "count": len(items), "source": source})

    last_id = items[-1]["id"] if items else state.get("last_id")
    return {"last_id": last_id, "runs": state.get("runs", 0) + 1}
'''
        (connector_dir / "connector.py").write_text(connector_code)

        # Config with non-secret params
        config = {"source": "test-source", "count": 5}
        config_path = Path(tmpdir) / "mockdata.config.json"
        config_path.write_text(json.dumps(config))

        # --- Run the connector ---
        inbox_dir = Path(tmpdir) / "inbox"
        state_path = str(config_path).replace(".json", ".state.json")
        state = load_state(state_path)

        # Load the connector module directly from its file path
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "mockdata_connector", connector_dir / "connector.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        ingest = mod.ingest

        new_state = ingest(config, state, str(inbox_dir))
        save_state(state_path, new_state)

        # --- Verify ---
        inbox_files = list(inbox_dir.glob("mockdata-*.json"))
        assert len(inbox_files) == 1, f"Expected 1 inbox file, got {len(inbox_files)}"

        with open(inbox_files[0]) as fh:
            data = json.load(fh)

        assert data["count"] == 5, f"Expected 5 items, got {data['count']}"
        assert len(data["items"]) == 5, f"Expected 5 items, got {len(data['items'])}"
        assert data["items"][0]["title"] == "Mock item 0 from test-source"
        assert data["items"][4]["id"] == "test-source-4"
        assert data["items"][0]["has_token"] is False  # no token set

        # Verify state was updated
        loaded_state = load_state(state_path)
        assert loaded_state["last_id"] == "test-source-4"
        assert loaded_state["runs"] == 1

        # --- Run again to verify state cursor works ---
        new_state2 = ingest(config, load_state(state_path), str(inbox_dir))
        save_state(state_path, new_state2)
        loaded_state2 = load_state(state_path)
        assert loaded_state2["runs"] == 2, f"Expected runs=2, got {loaded_state2['runs']}"

        print("PASS: Agent-generated connector runs and returns data with mock config")
        print(f"  - Created connector at: {connector_dir / 'connector.py'}")
        print(f"  - Inbox file: {inbox_files[0].name}")
        print(f"  - Items: {data['count']}")
        print(f"  - State after 2 runs: {loaded_state2}")
        return True
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    success = test_agent_generated_connector()
    sys.exit(0 if success else 1)
