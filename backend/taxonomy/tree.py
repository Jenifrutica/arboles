"""The n-ary taxonomic tree.

Two representations coexist on purpose:

* ``networkx.DiGraph`` — the library view. Gives us graph invariants
  (single root, no cycles, one component), ``ancestors``/``descendants``,
  DFS/BFS helpers and a trustworthy oracle during tests.
* flat NumPy arrays — the performance view. ``parent_index`` and ``depth``
  are contiguous ``int32`` arrays, which is what makes the binary lifting
  table in :mod:`taxonomy.lca` cheap to build and cache friendly.

The graph is *not* binary and has no key ordering: children are unordered and
a node may have 1, 2 or 166 of them. That is the defining property of this
case study, and it is why a self-balancing BST does not apply.
"""

from __future__ import annotations

from functools import cached_property
from typing import Iterable, Iterator

import networkx as nx
import numpy as np

from .model import Taxon


class TaxonomyTree:
    """Rooted, unordered, n-ary tree over NCBI taxa."""

    def __init__(self, taxa: Iterable[Taxon]) -> None:
        self._taxa: list[Taxon] = list(taxa)
        if not self._taxa:
            raise ValueError("a tree needs at least one taxon")

        self._index: dict[int, int] = {}
        for position, taxon in enumerate(self._taxa):
            if taxon.id in self._index:
                raise ValueError(f"duplicate taxon id {taxon.id}")
            self._index[taxon.id] = position

        size = len(self._taxa)
        self._ids = np.fromiter((t.id for t in self._taxa), dtype=np.int64, count=size)
        self._parents = np.fromiter(
            (self._index.get(t.parent, -1) for t in self._taxa), dtype=np.int32, count=size
        )

        roots = [i for i, taxon in enumerate(self._taxa) if taxon.parent == 0]
        if len(roots) != 1:
            raise ValueError(f"expected exactly one root, found {len(roots)}")
        self._root_index = roots[0]
        self._parents[self._root_index] = self._root_index

        orphans = np.flatnonzero(self._parents < 0)
        if orphans.size:
            missing = [self._taxa[i].id for i in orphans[:5]]
            raise ValueError(f"taxa with unknown parent: {missing}")

        self._children: dict[int, list[int]] = {}
        for position in range(size):
            if position == self._root_index:
                continue
            self._children.setdefault(int(self._parents[position]), []).append(position)

        self._depth = self._compute_depth()

    # ------------------------------------------------------------------ build

    def _compute_depth(self) -> np.ndarray:
        depth = np.zeros(len(self._taxa), dtype=np.int32)
        frontier = [self._root_index]
        visited = 1
        while frontier:
            nxt: list[int] = []
            for node in frontier:
                for child in self._children.get(node, ()):
                    depth[child] = depth[node] + 1
                    nxt.append(child)
            visited += len(nxt)
            frontier = nxt
        if visited != len(self._taxa):
            raise ValueError("tree is disconnected: some taxa never reach the root")
        return depth

    # ------------------------------------------------------------- accessors

    @property
    def size(self) -> int:
        return len(self._taxa)

    @property
    def root(self) -> Taxon:
        return self._taxa[self._root_index]

    @property
    def ids(self) -> np.ndarray:
        return self._ids

    @property
    def parent_index(self) -> np.ndarray:
        return self._parents

    @property
    def depth(self) -> np.ndarray:
        return self._depth

    @property
    def taxa(self) -> list[Taxon]:
        return self._taxa

    @cached_property
    def graph(self) -> nx.DiGraph:
        """NetworkX view, built once on demand."""
        graph = nx.DiGraph()
        graph.add_nodes_from(
            (taxon.id, {"name": taxon.name, "rank": taxon.rank}) for taxon in self._taxa
        )
        graph.add_edges_from((t.parent, t.id) for t in self._taxa if not t.is_root)
        return graph

    # -------------------------------------------------------------- lookups

    def index_of(self, taxid: int) -> int:
        try:
            return self._index[taxid]
        except KeyError as error:
            raise KeyError(f"unknown taxon {taxid}") from error

    def contains(self, taxid: int) -> bool:
        return taxid in self._index

    def taxon(self, taxid: int) -> Taxon:
        return self._taxa[self.index_of(taxid)]

    def taxon_at(self, index: int) -> Taxon:
        return self._taxa[index]

    def depth_of(self, taxid: int) -> int:
        return int(self._depth[self.index_of(taxid)])

    def children_of(self, taxid: int) -> list[Taxon]:
        index = self.index_of(taxid)
        return [self._taxa[child] for child in self._children.get(index, ())]

    def child_indexes(self, index: int) -> list[int]:
        return self._children.get(index, [])

    def lineage(self, taxid: int, *, include_self: bool = True) -> list[Taxon]:
        """Path from the root down to ``taxid`` (root first)."""
        cursor = self.index_of(taxid)
        chain: list[int] = []
        while True:
            chain.append(cursor)
            parent = int(self._parents[cursor])
            if parent == cursor:
                break
            cursor = parent
        if not include_self:
            chain = chain[1:]
        return [self._taxa[i] for i in reversed(chain)]

    def ancestor_ids(self, taxid: int, *, include_self: bool = True) -> list[int]:
        """Taxids from ``taxid`` up to the root."""
        return [t.id for t in reversed(self.lineage(taxid, include_self=include_self))]

    @cached_property
    def descendant_counts(self) -> np.ndarray:
        """Number of nodes in each subtree, computed bottom-up in one pass."""
        counts = np.ones(len(self._taxa), dtype=np.int64)
        order = np.argsort(-self._depth, kind="stable")
        for index in order:
            parent = int(self._parents[index])
            if parent != index:
                counts[parent] += counts[index]
        return counts

    def descendant_count(self, taxid: int) -> int:
        return int(self.descendant_counts[self.index_of(taxid)])

    # --------------------------------------------------------------- walking

    def walk(self, taxid: int | None = None, *, max_depth: int | None = None) -> Iterator[Taxon]:
        """Breadth-first iteration of a subtree, bounded by relative depth."""
        start = self._root_index if taxid is None else self.index_of(taxid)
        base = int(self._depth[start])
        frontier = [start]
        while frontier:
            nxt: list[int] = []
            for node in frontier:
                yield self._taxa[node]
                if max_depth is not None and int(self._depth[node]) - base >= max_depth:
                    continue
                nxt.extend(self._children.get(node, ()))
            frontier = nxt

    def subtree(self, taxid: int | None = None, *, max_depth: int | None = None) -> list[Taxon]:
        return list(self.walk(taxid, max_depth=max_depth))

    # ------------------------------------------------------------ invariants

    def validate(self) -> dict[str, object]:
        """Check every structural invariant and return a small report."""
        graph = self.graph
        report = {
            "nodes": self.size,
            "edges": graph.number_of_edges(),
            "is_directed_acyclic_graph": nx.is_directed_acyclic_graph(graph),
            "is_tree": graph.number_of_edges() == self.size - 1 and nx.is_weakly_connected(graph),
            "root": self.root.name,
            "max_depth": int(self._depth.max()),
            "max_fanout": max((len(c) for c in self._children.values()), default=0),
        }
        return report
