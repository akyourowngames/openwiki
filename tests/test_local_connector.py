#!/usr/bin/env python3
"""Test 6: Local directory connector runs as a standard pipeline.

Verifies that the local-directory connector:
  1. Has the same ingest(config, state, inbox_dir) -> new_state interface
  2. Accepts a directory path in config
  3. Reads files from that directory and writes them to .inbox/
  4. Works with the standard pipeline runner (same as web/github/rss)
"""

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from connectors.registry import get_connector, list_connectors  # noqa: E402
from connectors.base import load_state, save_state  # noqa: E402
from connectors.pipeline import add_pipeline, run_pipeline  # noqa: E402


def test_local_connector():
    tmpdir = tempfile.mkdtemp(prefix="ow-test-local-")
    try:
        # --- Create a source directory with some files ---
        src_dir = os.path.join(tmpdir, "my-docs")
        os.makedirs(src_dir)
        with open(os.path.join(src_dir, "notes.md"), "w") as f:
            f.write("# My Notes\n\nThis is important knowledge.\n")
        with open(os.path.join(src_dir, "ideas.txt"), "w") as f:
            f.write("Idea: build a personal wiki agent\n")
        os.makedirs(os.path.join(src_dir, "subdir"))
        with open(os.path.join(src_dir, "subdir", "deep.md"), "w") as f:
            f.write("# Deep thoughts\n\nNested content.\n")

        # --- Verify it's in the registry (same as other prebuilts) ---
        connectors = list_connectors()
        local_entry = next((c for c in connectors if c["name"] == "local"), None)
        assert local_entry is not None, "local connector not in registry"
        print(f"PASS: 'local' is registered as a prebuilt connector: {local_entry['description']}")

        # --- Run it directly (same interface as web/github/rss) ---
        mod = get_connector("local")
        assert hasattr(mod, "ingest"), "local connector missing ingest() function"

        config = {"dir": src_dir, "extensions": [".md", ".txt"], "max_files": 50}
        config_path = os.path.join(tmpdir, "local.config.json")
        with open(config_path, "w") as f:
            json.dump(config, f)

        inbox_dir = os.path.join(tmpdir, "inbox")
        state_path = config_path.replace(".json", ".state.json")
        state = load_state(state_path)

        new_state = mod.ingest(config, state, inbox_dir)
        save_state(state_path, new_state)

        # --- Verify data was written ---
        inbox_files = list(Path(inbox_dir).glob("local-*.json"))
        assert len(inbox_files) == 1, f"Expected 1 inbox file, got {len(inbox_files)}"

        with open(inbox_files[0]) as f:
            data = json.load(f)

        assert data["count"] == 3, f"Expected 3 files ingested, got {data['count']}"
        paths = [item["path"] for item in data["items"]]
        assert "notes.md" in paths
        assert "ideas.txt" in paths
        assert "subdir/deep.md" in paths
        print(f"PASS: Local connector ingested {data['count']} files from directory: {paths}")

        # --- Verify content was read ---
        notes_item = next(i for i in data["items"] if i["path"] == "notes.md")
        assert "important knowledge" in notes_item["content"]
        print(f"PASS: File contents were read correctly")

        # --- Verify state cursor ---
        loaded_state = load_state(state_path)
        assert loaded_state["runs"] == 1
        assert len(loaded_state["seen_files"]) == 3
        print(f"PASS: State cursor persisted with {len(loaded_state['seen_files'])} seen files")

        # --- Run as a standard pipeline (same as web/github/rss) ---
        pipelines_path = os.path.join(tmpdir, "pipelines.json")
        add_pipeline(
            name="local-ingest",
            connector="local",
            schedule="0 9 * * *",
            config_path=config_path,
            run_agent=False,
            pipelines_path=pipelines_path,
        )
        result = run_pipeline("local-ingest", cwd=tmpdir, pipelines_path=pipelines_path)
        assert result["pipeline"] == "local-ingest"
        assert result["connector_results"][0]["connector"] == "local"
        print(f"PASS: Local connector runs as a standard pipeline (same interface as web/github/rss)")

        # --- Second run: verify state increments ---
        result2 = run_pipeline("local-ingest", cwd=tmpdir, pipelines_path=pipelines_path)
        loaded_state2 = load_state(state_path)
        # Manual run (1) + first pipeline run (2) + second pipeline run (3)
        assert loaded_state2["runs"] == 3, f"Expected runs=3 (manual + 2 pipeline), got {loaded_state2['runs']}"
        print(f"PASS: State increments across runs (runs={loaded_state2['runs']})")

        print("\nALL PASS: Local directory connector runs as a standard pipeline")
        return True
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    success = test_local_connector()
    sys.exit(0 if success else 1)
