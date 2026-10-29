"""Loading of the curated taxonomy dataset."""

from __future__ import annotations

import json
import os
from pathlib import Path

from .model import Taxon

DEFAULT_DATA = Path(__file__).resolve().parent.parent / "data" / "taxdump_subset" / "taxonomy.json"


def dataset_path(path: str | Path | None = None) -> Path:
    """Resolve the dataset location: explicit argument, env var, then default."""
    if path is not None:
        return Path(path)
    from_env = os.environ.get("TAXONOMY_DATA")
    return Path(from_env) if from_env else DEFAULT_DATA


def read_subset(path: str | Path | None = None) -> tuple[list[Taxon], dict[str, object]]:
    """Read the JSON produced by ``scripts/build_subset.py``."""
    target = dataset_path(path)
    if not target.exists():
        raise FileNotFoundError(
            f"dataset not found at {target}. Run scripts/build_subset.py first."
        )
    payload = json.loads(target.read_text(encoding="utf-8"))
    taxa = [
        Taxon(
            id=row["id"],
            parent=row["parent"],
            name=row["name"],
            rank=row["rank"],
            custom=bool(row.get("custom", False)),
        )
        for row in payload["nodes"]
    ]
    meta = {
        "source": payload.get("source", "NCBI Taxonomy"),
        "license": payload.get("license", ""),
        "generated": payload.get("generated", ""),
        "stats": payload.get("stats", {}),
    }
    return taxa, meta
