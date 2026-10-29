"""LCA correctness: against NetworkX as an independent oracle, and naive vs fast."""

from __future__ import annotations

import numpy as np

from taxonomy.lca import BinaryLifting, LCAEngine
from taxonomy.tree import TaxonomyTree


def oracle(tree: TaxonomyTree, a: int, b: int) -> int:
    """Independent answer using NetworkX ancestors and the depth array."""
    graph = tree.graph
    ancestors_a = nx_ancestors(graph, a)
    cursor = b
    while cursor not in ancestors_a:
        cursor = tree.taxon(cursor).parent
    return cursor


def nx_ancestors(graph, node: int) -> set[int]:
    import networkx as nx

    return nx.ancestors(graph, node) | {node}


def test_matches_networkx_oracle(tree: TaxonomyTree, pairs: np.ndarray) -> None:
    lifting = BinaryLifting(tree)
    got = lifting.query_many(pairs)
    for (a, b), expected_index in zip(pairs, got):
        a_id = int(tree.taxon_at(int(a)).id)
        b_id = int(tree.taxon_at(int(b)).id)
        expected = oracle(tree, a_id, b_id)
        actual = tree.taxon_at(int(expected_index)).id
        assert actual == expected, (a_id, b_id, actual, expected)


def test_scalar_and_vectorised_agree(tree: TaxonomyTree, pairs: np.ndarray) -> None:
    lifting = BinaryLifting(tree)
    batch = lifting.query_many(pairs)
    for (a, b), expected in zip(pairs, batch):
        assert lifting.query_indexes(int(a), int(b)) == int(expected)


def test_naive_and_binary_return_same_ancestor(engine: LCAEngine, tree: TaxonomyTree) -> None:
    pairs = [(9606, 10090), (9606, 41956), (9606, 3702), (9606, 562), (7227, 6239)]
    for a, b in pairs:
        fast = engine.solve(a, b, mode="binary")
        slow = engine.solve(a, b, mode="naive")
        assert fast.lca == slow.lca


def test_known_ancestors(engine: LCAEngine) -> None:
    cases = {
        (9606, 10090): 314146,  # Euarchontoglires: primates + rodents
        (9606, 41956): 33154,  # Opisthokonta: animals + fungi
        (9606, 3702): 2759,  # Eukaryota: animals + plants
        (9606, 562): 131567,  # cellular organisms: eukaryotes + bacteria
        (9598, 9606): 207598,  # Homininae: human + chimpanzee
    }
    for (a, b), expected in cases.items():
        assert engine.solve(a, b).lca == expected


def test_binary_lifting_is_cheaper_than_climbing(engine: LCAEngine) -> None:
    result = engine.solve(9606, 562)
    assert result.steps < result.naive_steps


def test_trace_is_walkable(engine: LCAEngine, tree: TaxonomyTree) -> None:
    """Every jump must be a real ancestor relation of the stated size."""
    result = engine.solve(9606, 41956)
    positions = {"a": 9606, "b": 41956}
    for jump in result.trace:
        side = str(jump["side"])
        assert int(jump["source"]) == positions[side]
        stepped = tree.taxon(int(jump["target"]))
        assert stepped.id in {t.id for t in tree.lineage(int(jump["source"]))}
        positions[side] = stepped.id
    assert positions["a"] == result.lca


def test_paths_meet_at_the_ancestor(engine: LCAEngine) -> None:
    result = engine.solve(9606, 10090)
    assert result.path_a[0] == 9606 and result.path_a[-1] == result.lca
    assert result.path_b[0] == 10090 and result.path_b[-1] == result.lca
    assert set(result.path_a) & set(result.path_b) == {result.lca}
