"""Prefix index behaviour."""

from __future__ import annotations

from taxonomy.trie import NameIndex


def test_prefix_finds_landmark(index: NameIndex) -> None:
    names = [suggestion.name for suggestion in index.complete("homo")][:5]
    assert "Homo sapiens" in names


def test_prefix_is_case_insensitive(index: NameIndex) -> None:
    lower = index.complete("amanita")
    upper = index.complete("AMANITA")
    assert [s.id for s in lower] == [s.id for s in upper]
    assert 41956 in [s.id for s in lower]


def test_limit_is_respected(index: NameIndex) -> None:
    assert len(index.complete("a", limit=3)) <= 3


def test_empty_prefix_returns_nothing(index: NameIndex) -> None:
    assert index.complete("   ") == []


def test_exact_lookup(index: NameIndex) -> None:
    found = index.exact("Homo sapiens")
    assert [taxon.id for taxon in found] == [9606]
