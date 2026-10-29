"""Prefix index for taxon names, backed by a compact trie.

The autocomplete box needs "every name starting with these letters" in
``O(len(prefix))``, not a linear scan over 25k names. ``marisa-trie`` stores
the key set as a minimal automaton, so the whole index for every taxon name
costs about as much as a dictionary of the same keys but answers prefix queries
without building intermediate strings.

Names are indexed in lowercase; the original spelling is restored on output.
"""

from __future__ import annotations

from dataclasses import dataclass

import marisa_trie

from .model import Taxon


@dataclass(frozen=True, slots=True)
class Suggestion:
    id: int
    name: str
    rank: str
    depth: int

    def as_dict(self) -> dict[str, object]:
        return {"id": self.id, "name": self.name, "rank": self.rank, "depth": self.depth}


class NameIndex:
    """Case-insensitive prefix index over taxon names."""

    def __init__(self, taxa: list[Taxon], depths: list[int] | None = None) -> None:
        self._buckets: dict[str, list[int]] = {}
        keys: list[str] = []
        for taxon in taxa:
            key = taxon.name.casefold()
            if key not in self._buckets:
                self._buckets[key] = []
                keys.append(key)
            self._buckets[key].append(taxon.id)
        self._trie = marisa_trie.Trie(keys)
        self._taxa = {taxon.id: taxon for taxon in taxa}
        self._depths = depths or []

    def complete(self, prefix: str, *, limit: int = 12) -> list[Suggestion]:
        needle = prefix.casefold().strip()
        if not needle:
            return []

        # ``keys`` is a generator, so a bounded scan is cheap. We then rank by
        # usefulness: exact hit, then word-boundary hit ("Homo sapiens" when the
        # user typed "homo"), then everything else shortest-first. Without this
        # the trie answers in raw lexicographic order and buries the species
        # behind clades like "Homolodroioidea".
        candidates: list[str] = []
        for key in self._trie.keys(needle):
            candidates.append(key)
            if len(candidates) >= limit * 24:
                break

        def score(key: str) -> tuple[int, int, int]:
            deepest = max((self._depths.get(t, 0) for t in self._buckets.get(key, ())), default=0)
            if key == needle:
                return (0, -deepest, len(key))
            if key.startswith(needle + " "):
                return (1, -deepest, len(key))
            return (2, -deepest, len(key))

        results: list[Suggestion] = []
        for key in sorted(candidates, key=score):
            for taxid in self._buckets.get(key, ()):
                taxon = self._taxa[taxid]
                results.append(
                    Suggestion(
                        id=taxon.id,
                        name=taxon.name,
                        rank=taxon.rank,
                        depth=self._depths[taxid] if self._depths else 0,
                    )
                )
                if len(results) >= limit:
                    return results
        return results

    def exact(self, name: str) -> list[Taxon]:
        return [self._taxa[taxid] for taxid in self._buckets.get(name.casefold(), ())]

    def __len__(self) -> int:
        return len(self._buckets)
