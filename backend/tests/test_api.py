"""Contract of the HTTP layer."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_meta_describes_the_tree(client: TestClient) -> None:
    payload = client.get("/api/meta").json()
    assert payload["tree"]["is_tree"] is True
    assert payload["tree"]["nodes"] > 20_000
    assert payload["lca"]["query"] == "O(log n)"
    assert payload["lca"]["levels"] > 1


def test_taxonomy_payload_is_flat_and_compact(client: TestClient) -> None:
    payload = client.get("/api/taxonomy").json()
    assert payload["columns"] == ["id", "parent", "name", "rank", "custom"]
    assert len(payload["nodes"]) == len(payload["nodes"])
    root_rows = [row for row in payload["nodes"] if row[1] == 0]
    assert len(root_rows) == 1


def test_lca_endpoint(client: TestClient) -> None:
    payload = client.get("/api/lca", params={"a": 9606, "b": 41956}).json()
    assert payload["lca"]["name"] == "Opisthokonta"
    assert payload["a"]["id"] == 9606
    assert payload["path_a"][0] == 9606
    assert payload["path_a"][-1] == payload["lca"]["id"]
    assert payload["steps"] > 0


def test_naive_mode_is_slower_or_equal(client: TestClient) -> None:
    fast = client.get("/api/lca", params={"a": 9606, "b": 562, "mode": "binary"}).json()
    slow = client.get("/api/lca", params={"a": 9606, "b": 562, "mode": "naive"}).json()
    assert fast["lca"]["id"] == slow["lca"]["id"]
    assert fast["steps"] <= slow["steps"]


def test_unknown_taxon_is_404(client: TestClient) -> None:
    assert client.get("/api/lca", params={"a": 9606, "b": 999_999_999}).status_code == 404


def test_search_endpoint(client: TestClient) -> None:
    payload = client.get("/api/search", params={"q": "saccharo"}).json()
    assert any(item["name"] == "Saccharomyces cerevisiae" for item in payload)


def test_taxon_detail_has_lineage(client: TestClient) -> None:
    payload = client.get("/api/taxon/9606").json()
    assert payload["lineage"][0]["name"] == "root"
    assert payload["depth"] > 20
    assert payload["descendants"] == 1


def test_random_pair_is_interesting(client: TestClient) -> None:
    payload = client.get("/api/random-pair").json()
    assert payload["a"]["id"] != payload["b"]["id"]
