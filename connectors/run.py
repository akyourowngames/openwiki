#!/usr/bin/env python3
"""CLI runner for a single connector invocation.

Usage:
    python -m connectors.run <connector_name> --config <path> --inbox <dir> [--state <path>]

This is what the pipeline runner (and tests) call to execute a connector.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Ensure the project root is importable when run as a script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from connectors.registry import get_connector  # noqa: E402
from connectors.base import load_state, save_state  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run an OpenWiki connector")
    parser.add_argument("connector", help="Connector name (e.g. 'web', 'github', 'rss')")
    parser.add_argument("--config", required=True, help="Path to connector config JSON")
    parser.add_argument("--inbox", required=True, help="Directory to write raw data")
    parser.add_argument("--state", default=None, help="Path to state JSON (optional)")
    args = parser.parse_args()

    with open(args.config, encoding="utf-8") as fh:
        config = json.load(fh)

    state_path = args.state or args.config.replace(".json", ".state.json")
    state = load_state(state_path)

    mod = get_connector(args.connector)
    new_state = mod.ingest(config, state, args.inbox)
    save_state(state_path, new_state)

    print(json.dumps({"connector": args.connector, "state": new_state}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
