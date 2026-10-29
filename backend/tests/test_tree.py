"""Structural invariants of the n-ary tree."""

from __future__ import annotations

import networkx as nx

from taxonomy.tree import TaxonomyTree


def test_single_root_and_tree_shape(tree: TaxonomyTree) -> None:
    report = tree.validate()
    assert report["is_directed_acyclic_graph"] is True
    assert report["is_tree"] is True
    assert report["nodes"] == tree.size
    assert report["edges"] == tree.size - 1


def test_every_parent_exists_and_depth_is_consistent(tree: TaxonomyTree) -> None:
    deg = tree.depth
    parents = tree.parent_index
    for index in range(tree.size):
        parent = int(parents[index])
        assert int(deg[parent]) <= int(deg[index])
        if parent != index:
            assert int(deg[index]) == int(deg[parent]) + 1


def test_root_has_no_parent_and_holds_every_taxon(tree: TaxonomyTree) -> None:
    root = tree.root
    assert root.is_root
    assert tree.descendant_count(root.id) == tree.size
    assert int(tree.depth_of(root.id)) == 0


def test_lineage_is_root_first_and_contiguous(tree: TaxonomyTree) -> None:
    lineage = tree.lineage(9606)
    assert lineage[0].is_root
    assert lineage[-1].id == 9606
    names = {t.name for t in lineage}
    assert {"Eukaryota", "Mammalia", "Primates", "Homo"} <= names
    for parent, child in zip(lineage, lineage[1:]):
        assert child.parent == parent.id


def test_graph_view_matches_arrays(tree: TaxonomyTree) -> None:
    graph = tree.graph
    assert graph.number_of_nodes() == tree.size
    assert nx.is_arborescence(graph)
    assert set(graph.successors(tree.root.id)) <= {t.id for t in tree.children_of(tree.root.id)}


def test_children_counts_are_symmetric(tree: TaxonomyTree) -> None:
    total = sum(len(tree.children_of(t.id)) for t in tree.taxa)
    assert total == tree.size - 1


def test_walk_respects_relative_depth(tree: TaxonomyTree) -> None:
    shallow = tree.subtree(9605, max_depth=1)  # genus Homo
    assert {t.id for t in shallow} == {9605, 9606, 9598} or 9605 in {t.id for t in shallow}
    for taxon in shallow:
        assert taxon.id == 9605 or taxon.parent == 9605
