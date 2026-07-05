"""Connector registry — maps connector names to their module paths.

Used by the pipeline runner and the agent's ``list_connectors`` tool.
Agent-generated connectors are registered by placing a Python file in
``connectors/`` and adding an entry here (or discovered dynamically).
"""

from __future__ import annotations

import importlib
from typing import Any, Dict, List

# Prebuilt connectors that ship with the package.
PREBUILT: Dict[str, str] = {
    "web": "connectors.web",
    "github": "connectors.github",
    "rss": "connectors.rss",
    "local": "connectors.local",
}


def list_connectors() -> List[Dict[str, Any]]:
    """Return metadata for every registered connector."""
    result = []
    for name, module_path in PREBUILT.items():
        mod = importlib.import_module(module_path)
        doc = (mod.__doc__ or "").strip().split("\n")[0]
        result.append({"name": name, "module": module_path, "description": doc})
    return result


def get_connector(name: str):
    """Import and return the module for *name*, or raise ValueError."""
    module_path = PREBUILT.get(name)
    if not module_path:
        raise ValueError(f"Unknown connector: {name}")
    return importlib.import_module(module_path)
