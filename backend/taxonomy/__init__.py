"""Core taxonomy structures: n-ary tree, binary lifting LCA, prefix index."""

from .model import Taxon
from .tree import TaxonomyTree

__all__ = ["Taxon", "TaxonomyTree"]
