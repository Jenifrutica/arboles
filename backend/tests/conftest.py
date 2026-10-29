"""Shared fixtures. The dataset is loaded once and reused across tests."""

from __future__ import annotations

import numpy as np
import pytest

from taxonomy.lca import LCAEngine
from taxonomy.parser import read_subset
from taxonomy.tree import TaxonomyTree
from taxonomy.trie import NameIndex


@pytest.fixture(scope="session")
def tree() -> TaxonomyTree:
    taxa, _meta = read_subset()
    return TaxonomyTree(taxa)


@pytest.fixture(scope="session")
def engine(tree: TaxonomyTree) -> LCAEngine:
    return LCAEngine(tree)


@pytest.fixture(scope="session")
def index(tree: TaxonomyTree) -> NameIndex:
    depths = {t.id: tree.depth_of(t.id) for t in tree.taxa}
    return NameIndex(tree.taxa, depths)


@pytest.fixture(scope="session")
def pairs(tree: TaxonomyTree) -> np.ndarray:
    """A fixed sample of node-index pairs, seeded for reproducibility."""
    generator = np.random.default_rng(20261029)
    size = tree.size
    sample = generator.integers(0, size, size=(400, 2), dtype=np.int32)
    return sample
