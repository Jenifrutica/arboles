"""Request bodies and responses for the public API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class TaxonOut(BaseModel):
    id: int
    name: str
    rank: str
    depth: int
    parent: int | None = Field(default=None, description="null for the root")
    custom: bool = False


class LineageEntry(BaseModel):
    id: int
    name: str
    rank: str


class TaxonDetail(TaxonOut):
    lineage: list[LineageEntry]
    children: int
    descendants: int


class SuggestionOut(BaseModel):
    id: int
    name: str
    rank: str
    depth: int


class JumpOut(BaseModel):
    side: str = Field(description='"a" or "b"')
    source: int
    target: int
    power: int = Field(description="2**power nodes travelled in this jump")
    cumulative: int


class LCAResponse(BaseModel):
    a: TaxonOut
    b: TaxonOut
    lca: TaxonOut
    mode: str
    steps: int
    comparisons: int
    naive_steps: int
    path_a: list[int]
    path_b: list[int]
    trace: list[JumpOut]


class PairOut(BaseModel):
    a: TaxonOut
    b: TaxonOut


class MetaResponse(BaseModel):
    dataset: dict[str, object]
    tree: dict[str, object]
    lca: dict[str, object]
    index: dict[str, object]
    ranks: list[str]
    landmarks: list[TaxonOut]


class TaxonomyPayload(BaseModel):
    columns: list[str]
    root: int
    nodes: list[list[object]]


class CreateTaxon(BaseModel):
    """A node the user adds from the interface."""

    name: str = Field(min_length=1, max_length=80, description="nombre del nuevo taxón")
    parent: int = Field(description="taxid del nodo padre")
    rank: str = Field(default="clade", max_length=40, description="rango taxonómico")


class EditResult(BaseModel):
    removed: int = Field(description="nodos eliminados (incluye el subárbol si aplica)")
    remaining: int


class EditState(BaseModel):
    nodes: int
    custom: int
