"""Lowest common ancestor, implemented twice so the two can be compared.

1. **Ingenuous** — climb to the root collecting the ancestor set of ``a``, then
   walk ``b`` upwards until a shared node appears. ``O(h)`` per query with
   ``h`` = height of the tree (34 in the bundled dataset), and it allocates a
   set on every call.

2. **Binary lifting** — preprocess a sparse table where row ``k`` holds the
   ``2**k``-th ancestor of every node (``O(n log n)`` time and memory, built
   with vectorised NumPy shifts). Each query becomes ``O(log n)`` pointer
   reads: level ``a`` and ``b`` by their depth difference, then lift both by
   decreasing powers of two while their ancestors differ.

The second one is what the interface animates: the jumps of size 1, 2, 4, 8,
16 travel over the tree as visible teleports, while the ingenuous mode crawls
one edge at a time.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .tree import TaxonomyTree

ROOT_SENTINEL = 0


@dataclass(slots=True)
class Jump:
    """One animated movement of a cursor over the tree."""

    side: str
    source: int
    target: int
    power: int
    cumulative: int

    def as_dict(self) -> dict[str, object]:
        return {
            "side": self.side,
            "source": self.source,
            "target": self.target,
            "power": self.power,
            "cumulative": self.cumulative,
        }


@dataclass(slots=True)
class LCAResult:
    a: int
    b: int
    lca: int
    mode: str
    steps: int
    comparisons: int
    naive_steps: int
    path_a: list[int]
    path_b: list[int]
    trace: list[dict[str, object]] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "a": self.a,
            "b": self.b,
            "lca": self.lca,
            "mode": self.mode,
            "steps": self.steps,
            "comparisons": self.comparisons,
            "naive_steps": self.naive_steps,
            "path_a": self.path_a,
            "path_b": self.path_b,
            "trace": self.trace,
        }


class BinaryLifting:
    """Sparse table of ``2**k``-th ancestors, held as a NumPy matrix."""

    def __init__(self, tree: TaxonomyTree) -> None:
        self.tree = tree
        self.depth = tree.depth
        self.size = tree.size
        levels = max(1, int(self.depth.max()).bit_length())
        table = np.empty((levels, self.size), dtype=np.int32)
        table[0] = tree.parent_index
        for level in range(1, levels):
            previous = table[level - 1]
            table[level] = previous[previous]
        self.table = table
        self.levels = levels

    # ------------------------------------------------------------- querying

    def query(self, a: int, b: int) -> tuple[int, list[Jump]]:
        """Return (lca index, list of executed jumps) for two node indexes."""
        depth = self.depth
        trace: list[Jump] = []
        closed = 0

        if depth[a] < depth[b]:
            a, b = b, a
            swapped = True
        else:
            swapped = False

        difference = int(depth[a] - depth[b])
        for power in range(self.levels):
            if not (difference >> power) & 1:
                continue
            target = int(self.table[power][a])
            trace.append(
                Jump(side="b" if swapped else "a", source=int(a), target=target, power=power, cumulative=closed)
            )
            closed += 1
            a = target

        if a == b:
            return a, trace

        for power in range(self.levels - 1, -1, -1):
            ra = int(self.table[power][a])
            rb = int(self.table[power][b])
            if ra == rb:
                continue
            trace.append(Jump(side="a", source=int(a), target=ra, power=power, cumulative=closed))
            trace.append(Jump(side="b", source=int(b), target=rb, power=power, cumulative=closed))
            closed += 1
            a, b = ra, rb

        parent = int(self.table[0][a])
        trace.append(Jump(side="a", source=int(a), target=parent, power=0, cumulative=closed))
        trace.append(Jump(side="b", source=int(b), target=parent, power=0, cumulative=closed))
        closed += 1
        return parent, trace

    def query_indexes(self, a: int, b: int) -> int:
        return self.query(a, b)[0]

    def query_many(self, pairs: np.ndarray) -> np.ndarray:
        """Vectorised batch query. ``pairs`` is an (n, 2) array of node indexes."""
        left = pairs[:, 0].astype(np.int32, copy=True)
        right = pairs[:, 1].astype(np.int32, copy=True)
        depth = self.depth

        swap = depth[left] < depth[right]
        left[swap], right[swap] = right[swap], left[swap]

        difference = (depth[left] - depth[right]).astype(np.int64)
        for power in range(self.levels):
            selected = ((difference >> power) & 1).astype(bool)
            if selected.any():
                left[selected] = self.table[power][left[selected]]

        settled = left == right
        for power in range(self.levels - 1, -1, -1):
            ancestor_left = self.table[power][left]
            ancestor_right = self.table[power][right]
            move = (~settled) & (ancestor_left != ancestor_right)
            if move.any():
                left[move] = ancestor_left[move]
                right[move] = ancestor_right[move]

        return np.where(settled, left, self.table[0][left])

    # --------------------------------------------------------------- helpers

    def ancestors_at(self, index: int, power: int) -> int:
        return int(self.table[power][index])

    @property
    def memory_bytes(self) -> int:
        return int(self.table.nbytes)


class LCAEngine:
    """Facade used by the API: resolves taxids and produces animatable traces."""

    def __init__(self, tree: TaxonomyTree) -> None:
        self.tree = tree
        self.lifting = BinaryLifting(tree)

    # -------------------------------------------------------------- public

    def solve(self, a: int, b: int, *, mode: str = "binary") -> LCAResult:
        if mode not in {"binary", "naive"}:
            raise ValueError(f"unknown mode {mode!r}")
        index_a = self.tree.index_of(a)
        index_b = self.tree.index_of(b)

        if mode == "binary":
            lca_index, jumps = self.lifting.query(index_a, index_b)
            trace = [
                {
                    "side": jump.side,
                    "source": self.tree.taxon_at(jump.source).id,
                    "target": self.tree.taxon_at(jump.target).id,
                    "power": jump.power,
                    "cumulative": jump.cumulative,
                }
                for jump in jumps
            ]
            steps = len(jumps)
            comparisons = steps + 1
        else:
            lca_index, steps, comparisons, trace = self._naive(index_a, index_b)

        naive_steps = self._naive_cost(index_a, index_b, lca_index)
        path_a = self._path(a, self.tree.taxon_at(lca_index).id)
        path_b = self._path(b, self.tree.taxon_at(lca_index).id)

        return LCAResult(
            a=a,
            b=b,
            lca=self.tree.taxon_at(lca_index).id,
            mode=mode,
            steps=steps,
            comparisons=comparisons,
            naive_steps=naive_steps,
            path_a=path_a,
            path_b=path_b,
            trace=trace,
        )

    # ------------------------------------------------------------- internal

    def _path(self, start: int, stop: int) -> list[int]:
        """Taxids from ``start`` up to ``stop`` (both included)."""
        cursor = self.tree.index_of(start)
        stop_index = self.tree.index_of(stop)
        path: list[int] = []
        while True:
            path.append(self.tree.taxon_at(cursor).id)
            if cursor == stop_index:
                break
            cursor = int(self.tree.parent_index[cursor])
        return path

    def _naive_cost(self, a: int, b: int, lca: int) -> int:
        """How many single-edge hops the ingenuous algorithm needs."""
        depth = self.tree.depth
        return int(depth[a] + depth[b] - 2 * depth[lca])

    def _naive(self, a: int, b: int) -> tuple[int, int, int, list[dict[str, object]]]:
        """Set-based climb; the trace is one event per single-edge hop."""
        parents = self.tree.parent_index
        seen: dict[int, int] = {}
        trace: list[dict[str, object]] = []
        cursor = a
        comparisons = 0
        while True:
            seen[cursor] = len(seen)
            comparisons += 1
            parent = int(parents[cursor])
            if parent == cursor:
                break
            trace.append(
                {
                    "side": "a",
                    "source": int(cursor),
                    "target": parent,
                    "power": 0,
                    "cumulative": len(trace),
                }
            )
            cursor = parent

        cursor = b
        while cursor not in seen:
            comparisons += 1
            parent = int(parents[cursor])
            trace.append(
                {
                    "side": "b",
                    "source": int(cursor),
                    "target": parent,
                    "power": 0,
                    "cumulative": len(trace),
                }
            )
            cursor = parent
        comparisons += 1
        return cursor, len(trace), comparisons, trace
