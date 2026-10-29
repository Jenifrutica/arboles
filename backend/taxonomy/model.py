"""The single unit of the domain: one node of the taxonomic tree."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Taxon:
    """A node of the n-ary taxonomic tree.

    ``parent`` is 0 for the root, which keeps the JSON payload free of nulls.
    Ranks come straight from NCBI ("kingdom", "clade", "family", ...).
    ``custom`` marks nodes created from the interface, so the UI can draw them
    differently and the original dataset stays distinguishable.
    """

    id: int
    parent: int
    name: str
    rank: str
    custom: bool = False

    @property
    def is_root(self) -> bool:
        return self.parent == 0

    def as_row(self) -> list[object]:
        """Compact row used by the wire format: [id, parent, name, rank, custom]."""
        return [self.id, self.parent, self.name, self.rank, self.custom]
