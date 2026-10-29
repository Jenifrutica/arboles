"""Build a curated, visualisable subset of the NCBI taxonomy.

The full taxdump holds ~3M taxa, which is far too much to draw and far too much
to ship inside a course repository. This script keeps every taxon above the
species level whose rank is meaningful for a visual tree, path-compresses the
nodes it drops (so no branch ever disappears), and always keeps a hand-picked
list of landmark species so the LCA demo has recognisable endpoints.

Output: a single JSON file consumed by the FastAPI backend and the web client.

Usage:
    python scripts/build_subset.py --dump /tmp/taxdump --out data/taxdump_subset
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np

# Ranks that deserve their own node in the rendered tree.
KEEP_RANKS = frozenset(
    {
        "acellular root",
        "cellular root",
        "domain",
        "superkingdom",
        "kingdom",
        "subkingdom",
        "realm",
        "superphylum",
        "phylum",
        "subphylum",
        "superclass",
        "class",
        "subclass",
        "infraclass",
        "superorder",
        "order",
        "suborder",
        "infraorder",
        "parvorder",
        "superfamily",
        "family",
        "subfamily",
        "tribe",
        "subtribe",
        "clade",
        "species group",
        "species subgroup",
        "series",
        "section",
    }
)

# Ranks at or below the species level. Once we reach one of these we stop
# descending: everything below is strains, isolates and cultivar noise.
SPECIES_LIKE = frozenset(
    {
        "species",
        "subspecies",
        "varietas",
        "subvariety",
        "forma",
        "forma specialis",
        "strain",
        "isolate",
        "serotype",
        "serogroup",
        "genotype",
        "biotype",
        "morph",
        "pathogroup",
    }
)

# NCBI ships several self-parented roots (cellular organisms and viruses).
# Keeping taxid 1 ("root") glued on top turns the dataset into a single tree.
ALWAYS_KEEP = {1}

# Recognisable endpoints for the "common ancestor" demo. Every one of these is
# kept together with its full lineage.
LANDMARKS = {
    9606: "Homo sapiens",
    9598: "Pan troglodytes",
    10090: "Mus musculus",
    7955: "Danio rerio",
    9031: "Gallus gallus",
    7227: "Drosophila melanogaster",
    7460: "Apis mellifera",
    6239: "Caenorhabditis elegans",
    6645: "Octopus vulgaris",
    400682: "Amphimedon queenslandica",
    3702: "Arabidopsis thaliana",
    4577: "Zea mays",
    4530: "Oryza sativa",
    4081: "Solanum lycopersicum",
    3311: "Ginkgo biloba",
    3352: "Pinus taeda",
    3218: "Physcomitrium patens",
    3055: "Chlamydomonas reinhardtii",
    41956: "Amanita muscaria",
    5341: "Agaricus bisporus",
    4932: "Saccharomyces cerevisiae",
    5833: "Plasmodium falciparum",
    5691: "Trypanosoma brucei",
    5741: "Giardia intestinalis",
    5759: "Entamoeba histolytica",
    562: "Escherichia coli",
    1423: "Bacillus subtilis",
    274: "Thermus thermophilus",
    2336: "Thermotoga maritima",
    2190: "Methanocaldococcus jannaschii",
    2285: "Sulfolobus acidocaldarius",
}


def parse_nodes(path: Path) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Read nodes.dmp into three parallel arrays: taxid, parent taxid, rank."""
    ids: list[int] = []
    parents: list[int] = []
    ranks: list[str] = []
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            parts = line.split("\t|\t")
            if len(parts) < 3:
                continue
            ids.append(int(parts[0]))
            parents.append(int(parts[1]))
            ranks.append(parts[2].strip())
    return np.asarray(ids, dtype=np.int64), np.asarray(parents, dtype=np.int64), ranks


def build_index(ids: np.ndarray, parents: np.ndarray) -> tuple[np.ndarray, dict[int, int]]:
    """Return (parent_index, taxid -> index) with -1 for the root's parent."""
    order = np.argsort(ids)
    sorted_ids = ids[order]
    positions = np.searchsorted(sorted_ids, parents)
    positions = np.clip(positions, 0, len(sorted_ids) - 1)
    resolved = sorted_ids[positions] == parents
    parent_index = order[positions].astype(np.int64)
    parent_index[~resolved] = -1
    index_of = {int(taxid): int(i) for i, taxid in enumerate(ids)}
    root_index = index_of.get(1)
    if root_index is not None:
        parent_index[root_index] = -1
    return parent_index, index_of


def children_csr(parent_index: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Compressed sparse row of children, verbose but flat and fast to walk."""
    n = len(parent_index)
    degree = np.bincount(parent_index[parent_index >= 0] + 1, minlength=n + 1)
    starts = np.zeros(n + 1, dtype=np.int64)
    np.cumsum(degree[1:], out=starts[1:])
    order = np.argsort(parent_index, kind="stable")
    valid = parent_index[order] >= 0
    return starts, order[valid]


def walk(
    parent_index: np.ndarray,
    starts: np.ndarray,
    children: np.ndarray,
    ids: np.ndarray,
    ranks: list[str],
    always: set[int] | None = None,
) -> tuple[list[int], list[int]]:
    """Depth-first walk that keeps the interesting nodes and path-compresses the rest.

    Nodes that are dropped (strains, isolates, cultivar noise) are not lost: their
    subtrees are re-attached to the closest kept ancestor, so every branch that
    leads to a landmark species survives the pruning.
    """
    root = int(np.flatnonzero(parent_index < 0)[0])
    keep: list[int] = []
    kept_parent: list[int] = []
    landmarks = set(LANDMARKS) | (always or set())
    stack: list[tuple[int, int]] = [(root, -1)]
    while stack:
        node, ancestor = stack.pop()
        rank = ranks[node]
        if rank in KEEP_RANKS or int(ids[node]) in landmarks:
            keep.append(node)
            kept_parent.append(ancestor)
            ancestor = node
        if rank in SPECIES_LIKE:
            continue
        begin, end = int(starts[node]), int(starts[node + 1])
        for child in children[begin:end]:
            stack.append((int(child), ancestor))
    return keep, kept_parent


def read_names(path: Path, wanted: set[int]) -> dict[int, str]:
    """Extract scientific names only for the taxa we kept."""
    names: dict[int, str] = {}
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            parts = line.split("\t|\t")
            if len(parts) < 4:
                continue
            if not parts[3].startswith("scientific name"):
                continue
            try:
                taxid = int(parts[0])
            except ValueError:
                continue
            if taxid in wanted:
                names[taxid] = parts[1].strip()
    return names


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dump", type=Path, required=True, help="directory with nodes.dmp and names.dmp")
    parser.add_argument("--out", type=Path, required=True, help="output directory")
    args = parser.parse_args()

    nodes_path = args.dump / "nodes.dmp"
    names_path = args.dump / "names.dmp"
    for path in (nodes_path, names_path):
        if not path.exists():
            print(f"missing input: {path}", file=sys.stderr)
            return 1

    print("reading nodes.dmp ...")
    ids, parents, ranks = parse_nodes(nodes_path)
    print(f"  {len(ids):,} taxa")

    print("indexing parent/child relations ...")
    parent_index, index_of = build_index(ids, parents)
    starts, children = children_csr(parent_index)

    # The genus of every landmark species is worth keeping: it is the node that
    # makes "human vs chimpanzee" answer Homo instead of a subfamily.
    library = dict(zip(ids.tolist(), parents.tolist()))
    rank_of = dict(zip(ids.tolist(), ranks))
    always = set(ALWAYS_KEEP)
    for taxid in LANDMARKS:
        parent = library.get(taxid)
        if parent and rank_of.get(parent) in {"genus", "subgenus"}:
            always.add(parent)

    print("selecting nodes ...")
    keep, kept_parent = walk(parent_index, starts, children, ids, ranks, always)
    print(f"  kept {len(keep):,} nodes")

    kept_ids = {int(ids[i]) for i in keep}
    missing = set(LANDMARKS) - kept_ids
    if missing:
        print(f"  warning: landmarks not found {sorted(missing)}", file=sys.stderr)

    print("reading names.dmp (this one is big) ...")
    names = read_names(names_path, kept_ids)

    local = {node: position for position, node in enumerate(keep)}
    nodes = []
    for position, node in enumerate(keep):
        parent = kept_parent[position]
        nodes.append(
            {
                "id": int(ids[node]),
                "parent": int(ids[parent]) if parent >= 0 else 0,
                "name": names.get(int(ids[node]), f"taxon {int(ids[node])}"),
                "rank": ranks[node],
            }
        )

    depths = np.zeros(len(nodes), dtype=np.int32)
    by_id = {entry["id"]: position for position, entry in enumerate(nodes)}
    for position, entry in enumerate(nodes):
        depth = 0
        cursor = entry
        seen = 0
        while cursor["parent"] != 0 and seen <= len(nodes):
            cursor = nodes[by_id[cursor["parent"]]]
            depth += 1
            seen += 1
        depths[position] = depth

    rank_counts: dict[str, int] = {}
    for entry in nodes:
        rank_counts[entry["rank"]] = rank_counts.get(entry["rank"], 0) + 1

    payload = {
        "source": "NCBI Taxonomy (taxdump)",
        "license": "dominio público",
        "generated": date.today().isoformat(),
        "stats": {
            "total_taxa_in_source": int(len(ids)),
            "kept_nodes": len(nodes),
            "landmarks": len(LANDMARKS),
            "max_depth": int(depths.max()) if len(depths) else 0,
            "ranks": dict(sorted(rank_counts.items(), key=lambda item: -item[1])),
        },
        "nodes": nodes,
    }

    args.out.mkdir(parents=True, exist_ok=True)
    target = args.out / "taxonomy.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    size_mb = target.stat().st_size / (1024 * 1024)
    print(f"wrote {target} ({size_mb:.2f} MB)")
    print(f"  max depth: {payload['stats']['max_depth']}")
    print(f"  top ranks: {list(payload['stats']['ranks'].items())[:6]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
