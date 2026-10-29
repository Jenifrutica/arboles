"""Edición del árbol: insertar y eliminar nodos."""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.main import app
from taxonomy.model import Taxon
from taxonomy.tree import TaxonomyTree


def make_tree() -> TaxonomyTree:
    return TaxonomyTree(
        [
            Taxon(1, 0, "root", "no rank"),
            Taxon(2, 1, "Bacteria", "domain"),
            Taxon(3, 2, "Firmicutes", "phylum"),
            Taxon(4, 3, "Bacillus", "genus"),
            Taxon(5, 1, "Eukaryota", "domain"),
        ]
    )


def test_insert_keeps_invariants() -> None:
    tree = make_tree()
    taxa = list(tree.taxa) + [Taxon(99, 5, "Metazoa", "kingdom")]
    grown = TaxonomyTree(taxa)
    assert grown.size == 6
    assert grown.depth_of(99) == 2
    assert grown.validate()["is_tree"] is True
    assert grown.children_of(5)[0].id == 99


def test_delete_reparent_keeps_branch() -> None:
    tree = make_tree()
    # borrar "Firmicutes" y reenganchar su hijo a Bacteria
    survivors = [
        Taxon(t.id, 2 if t.parent == 3 else t.parent, t.name, t.rank)
        for t in tree.taxa
        if t.id != 3
    ]
    shrunk = TaxonomyTree(survivors)
    assert shrunk.size == 4
    assert shrunk.taxon(4).parent == 2
    assert shrunk.validate()["is_tree"] is True


def test_delete_subtree_removes_descendants() -> None:
    tree = make_tree()
    survivors = [t for t in tree.taxa if t.id not in {3, 4}]
    shrunk = TaxonomyTree(survivors)
    assert shrunk.size == 3
    assert not shrunk.contains(4)


# ------------------------------------------------------------------- HTTP


def test_create_and_delete_over_http() -> None:
    with TestClient(app) as client:
        before = client.get("/api/taxonomy").json()
        assert len(before["nodes"]) > 20_000
        assert before["columns"] == ["id", "parent", "name", "rank", "custom"]

        created = client.post(
            "/api/taxa", json={"name": "Cristalavirus jeniferae", "parent": 2, "rank": "clade"}
        )
        assert created.status_code == 201
        body = created.json()
        assert body["custom"] is True
        assert body["parent"] == 2

        after = client.get("/api/taxonomy").json()
        assert len(after["nodes"]) == len(before["nodes"]) + 1

        removed = client.delete(f"/api/taxa/{body['id']}")
        assert removed.status_code == 200
        assert removed.json()["removed"] == 1
        assert len(client.get("/api/taxonomy").json()["nodes"]) == len(before["nodes"])


def test_deleting_the_root_is_refused() -> None:
    with TestClient(app) as client:
        response = client.delete("/api/taxa/1")
        assert response.status_code == 422


def test_inserting_under_unknown_parent_is_404() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/taxa", json={"name": "Fantasma", "parent": 987_654_321, "rank": "clade"}
        )
        assert response.status_code == 404
