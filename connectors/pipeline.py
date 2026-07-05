#!/usr/bin/env python3
"""Pipeline runner — executes a pipeline (connectors + optional agent update).

A pipeline is a named schedule that:
  1. Runs one or more connectors, writing raw data to .inbox/
  2. Optionally triggers the OpenWiki update agent on the staged data

Scheduling uses real OS-level cron jobs (installed via `openwiki --install-cron`),
not a long-running process.

Usage:
    python -m connectors.pipeline run <pipeline_name> [--pipelines <path>] [--cwd <dir>]
    python -m connectors.pipeline add <name> --connector <c> --schedule <cron> [--no-agent]
    python -m connectors.pipeline list [--pipelines <path>]

Pipeline config (pipelines.json):
    {
      "pipelines": [
        {
          "name": "daily-web",
          "schedule": "0 9 * * *",
          "connectors": [
            {"name": "web", "config": "connectors/samples/web.config.json"}
          ],
          "runAgent": true
        }
      ]
    }
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from connectors.registry import get_connector  # noqa: E402
from connectors.base import load_state, save_state  # noqa: E402

DEFAULT_PIPELINES_PATH = "pipelines.json"


# ---------------------------------------------------------------------------
# Config persistence
# ---------------------------------------------------------------------------

def load_pipelines(path: str = DEFAULT_PIPELINES_PATH) -> Dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"pipelines": []}


def save_pipelines(config: Dict[str, Any], path: str = DEFAULT_PIPELINES_PATH) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(config, fh, indent=2, ensure_ascii=False)


def add_pipeline(
    name: str,
    connector: str,
    schedule: str,
    config_path: str,
    run_agent: bool = True,
    pipelines_path: str = DEFAULT_PIPELINES_PATH,
) -> Dict[str, Any]:
    config = load_pipelines(pipelines_path)
    pipeline = {
        "name": name,
        "schedule": schedule,
        "connectors": [{"name": connector, "config": config_path}],
        "runAgent": run_agent,
    }
    # Replace if exists, otherwise append
    config["pipelines"] = [p for p in config["pipelines"] if p["name"] != name]
    config["pipelines"].append(pipeline)
    save_pipelines(config, pipelines_path)
    return pipeline


def list_pipelines(pipelines_path: str = DEFAULT_PIPELINES_PATH) -> List[Dict[str, Any]]:
    return load_pipelines(pipelines_path).get("pipelines", [])


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def run_pipeline(name: str, cwd: str = ".", pipelines_path: str = DEFAULT_PIPELINES_PATH) -> Dict[str, Any]:
    config = load_pipelines(pipelines_path)
    pipeline = next((p for p in config["pipelines"] if p["name"] == name), None)
    if not pipeline:
        raise ValueError(f"Pipeline not found: {name}")

    inbox_dir = os.path.join(cwd, ".inbox")
    os.makedirs(inbox_dir, exist_ok=True)

    results: List[Dict[str, Any]] = []
    for conn_cfg in pipeline["connectors"]:
        conn_name = conn_cfg["name"]
        conn_config_path = conn_cfg["config"]
        with open(conn_config_path, encoding="utf-8") as fh:
            conn_config = json.load(fh)

        state_path = conn_config_path.replace(".json", ".state.json")
        state = load_state(state_path)

        mod = get_connector(conn_name)
        new_state = mod.ingest(conn_config, state, inbox_dir)
        save_state(state_path, new_state)
        results.append({"connector": conn_name, "state": new_state})

    agent_result = None
    if pipeline.get("runAgent", True):
        agent_result = run_update_agent(cwd)

    return {"pipeline": name, "connector_results": results, "agent_result": agent_result}


def run_update_agent(cwd: str) -> Dict[str, Any]:
    """Run the OpenWiki update agent on the staged inbox data.

    Uses the installed ``openwiki`` CLI if available; otherwise returns a
    stub indicating the agent was skipped.
    """
    try:
        result = subprocess.run(
            ["openwiki", "--update", "-p", "Update the wiki from new inbox data."],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=300,
            env=os.environ.copy(),
        )
        return {
            "ran": True,
            "exit_code": result.returncode,
            "stdout": result.stdout[:2000],
            "stderr": result.stderr[:2000],
        }
    except FileNotFoundError:
        return {"ran": False, "reason": "openwiki CLI not found"}
    except subprocess.TimeoutExpired:
        return {"ran": False, "reason": "agent timed out"}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="OpenWiki pipeline manager")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="Run a pipeline once")
    p_run.add_argument("name")
    p_run.add_argument("--pipelines", default=DEFAULT_PIPELINES_PATH)
    p_run.add_argument("--cwd", default=".")

    p_add = sub.add_parser("add", help="Add a new pipeline")
    p_add.add_argument("name")
    p_add.add_argument("--connector", required=True)
    p_add.add_argument("--schedule", required=True)
    p_add.add_argument("--config", required=True)
    p_add.add_argument("--no-agent", action="store_true")
    p_add.add_argument("--pipelines", default=DEFAULT_PIPELINES_PATH)

    p_list = sub.add_parser("list", help="List configured pipelines")
    p_list.add_argument("--pipelines", default=DEFAULT_PIPELINES_PATH)

    args = parser.parse_args()

    if args.cmd == "run":
        result = run_pipeline(args.name, cwd=args.cwd, pipelines_path=args.pipelines)
        print(json.dumps(result, indent=2, default=str))
    elif args.cmd == "add":
        pipeline = add_pipeline(
            args.name, args.connector, args.schedule, args.config,
            run_agent=not args.no_agent, pipelines_path=args.pipelines,
        )
        print(json.dumps({"created": pipeline}, indent=2))
    elif args.cmd == "list":
        print(json.dumps(list_pipelines(args.pipelines), indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
