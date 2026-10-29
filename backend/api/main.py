"""FastAPI application: the Python brain behind the 3D interface."""

from __future__ import annotations

import random
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Iterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from taxonomy.lca import LCAEngine
from taxonomy.model import Taxon
from taxonomy.parser import read_subset
from taxonomy.tree import TaxonomyTree
from taxonomy.trie import NameIndex

from .schemas import (
    CreateTaxon,
    EditResult,
    EditState,
    JumpOut,
    LCAResponse,
    LineageEntry,
    MetaResponse,
    PairOut,
    SuggestionOut,
    TaxonDetail,
    TaxonOut,
    TaxonomyPayload,
)

# Landmarks are the species the assignment asks students to reason about.
# They double as demo material and as generated quiz material.
LANDMARK_IDS = [
    9606,  # Homo sapiens
    9598,  # Pan troglodytes
    10090,  # Mus musculus
    7955,  # Danio rerio
    9031,  # Gallus gallus
    7227,  # Drosophila melanogaster
    7460,  # Apis mellifera
    6239,  # Caenorhabditis elegans
    6645,  # Octopus vulgaris
    3702,  # Arabidopsis thaliana
    4577,  # Zea mays
    4530,  # Oryza sativa
    3311,  # Ginkgo biloba
    3218,  # Physcomitrium patens
    3055,  # Chlamydomonas reinhardtii
    41956,  # Amanita muscaria
    5341,  # Agaricus bisporus
    4932,  # Saccharomyces cerevisiae
    5833,  # Plasmodium falciparum
    5691,  # Trypanosoma brucei
    562,  # Escherichia coli
    1423,  # Bacillus subtilis
    2190,  # Methanocaldococcus jannaschii
    2285,  # Sulfolobus acidocaldarius
]


class Runtime:
    """Holds the loaded structures for the lifetime of the process.

    The tree is mutable: the interface can add and remove taxa. Every edit
    rebuilds the derived structures (index arrays, depth vector, binary lifting
    table, prefix trie) — all of them are O(n log n) or better, so 25k nodes
    rebuild in a few milliseconds.
    """

    def __init__(self) -> None:
        self.taxa, self.meta = read_subset()
        self._next_id = max(taxon.id for taxon in self.taxa) + 1
        self.rebuild()

    # ---------------------------------------------------------------- derived

    def rebuild(self) -> None:
        self.tree = TaxonomyTree(self.taxa)
        self.engine = LCAEngine(self.tree)
        depths = {taxon.id: self.tree.depth_of(taxon.id) for taxon in self.taxa}
        self.index = NameIndex(self.taxa, depths)
        self.report = self.tree.validate()
        landmark_ids = set(LANDMARK_IDS)
        self.landmarks = [taxon for taxon in self.taxa if taxon.id in landmark_ids]
        self.ranks = sorted({taxon.rank for taxon in self.taxa})

    def to_taxon_out(self, taxid: int) -> TaxonOut:
        taxon = self.tree.taxon(taxid)
        return TaxonOut(
            id=taxon.id,
            name=taxon.name,
            rank=taxon.rank,
            depth=self.tree.depth_of(taxon.id),
            parent=None if taxon.is_root else taxon.parent,
            custom=taxon.custom,
        )

    # ------------------------------------------------------------------ edits

    def add(self, name: str, parent: int, rank: str) -> Taxon:
        cleaned = name.strip()
        if not cleaned:
            raise ValueError("el nombre no puede estar vacío")
        if not self.tree.contains(parent):
            raise KeyError(f"no existe el taxón {parent}")
        taxon = Taxon(
            id=self._next_id,
            parent=parent,
            name=cleaned,
            rank=rank.strip().lower() or "clade",
            custom=True,
        )
        self._next_id += 1
        self.taxa.append(taxon)
        self.rebuild()
        return taxon

    def remove(self, taxid: int, strategy: str = "reparent") -> int:
        if taxid == self.tree.root.id:
            raise ValueError("la raíz no se puede eliminar")
        node = self.tree.taxon(taxid)

        doomed: set[int] = {taxid}
        if strategy == "subtree":
            frontier = [taxid]
            while frontier:
                current = frontier.pop()
                for child in self.tree.children_of(current):
                    doomed.add(child.id)
                    frontier.append(child.id)
        elif strategy != "reparent":
            raise ValueError(f"estrategia desconocida {strategy!r}")

        survivors: list[Taxon] = []
        for taxon in self.taxa:
            if taxon.id in doomed:
                continue
            if strategy == "reparent" and taxon.parent == taxid:
                survivors.append(Taxon(taxon.id, node.parent, taxon.name, taxon.rank, taxon.custom))
            else:
                survivors.append(taxon)

        self.taxa = survivors
        self.rebuild()
        return len(doomed)


runtime: Runtime | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> Iterator[None]:
    global runtime
    runtime = Runtime()
    yield
    runtime = None


def get_runtime() -> Runtime:
    if runtime is None:  # pragma: no cover - only hit outside the app lifespan
        raise HTTPException(status_code=503, detail="dataset not loaded")
    return runtime


app = FastAPI(
    title="Árbol de la Vida · API",
    description="Ancestro común más cercano sobre la taxonomía de NCBI, con edición del árbol",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/meta", response_model=MetaResponse)
def meta() -> MetaResponse:
    rt = get_runtime()
    return MetaResponse(
        dataset=rt.meta,
        tree=rt.report,
        lca={
            "levels": rt.engine.lifting.levels,
            "table_bytes": rt.engine.lifting.memory_bytes,
            "build": "O(n log n)",
            "query": "O(log n)",
        },
        index={"keys": len(rt.index)},
        ranks=rt.ranks,
        landmarks=[rt.to_taxon_out(taxon.id) for taxon in rt.landmarks],
    )


@app.get("/api/taxonomy", response_model=TaxonomyPayload)
def taxonomy() -> TaxonomyPayload:
    rt = get_runtime()
    rows = sorted(rt.taxa, key=lambda taxon: rt.tree.depth_of(taxon.id))
    return TaxonomyPayload(
        columns=["id", "parent", "name", "rank", "custom"],
        root=rt.tree.root.id,
        nodes=[taxon.as_row() for taxon in rows],
    )


@app.get("/api/taxon/{taxid}", response_model=TaxonDetail)
def taxon(taxid: int) -> TaxonDetail:
    rt = get_runtime()
    try:
        rt.tree.taxon(taxid)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    base = rt.to_taxon_out(taxid)
    return TaxonDetail(
        **base.model_dump(),
        lineage=[
            LineageEntry(id=t.id, name=t.name, rank=t.rank) for t in rt.tree.lineage(taxid)
        ],
        children=len(rt.tree.children_of(taxid)),
        descendants=rt.tree.descendant_count(taxid),
    )


@app.get("/api/search", response_model=list[SuggestionOut])
def search(
    q: str = Query(min_length=1, max_length=64, description="prefijo del nombre"),
    limit: int = Query(default=10, ge=1, le=50),
) -> list[SuggestionOut]:
    rt = get_runtime()
    return [SuggestionOut(**s.as_dict()) for s in rt.index.complete(q, limit=limit)]


@app.get("/api/lca", response_model=LCAResponse)
def lca(
    a: int = Query(description="taxid de la primera especie"),
    b: int = Query(description="taxid de la segunda especie"),
    mode: str = Query(default="binary", pattern="^(binary|naive)$"),
) -> LCAResponse:
    rt = get_runtime()
    try:
        result = rt.engine.solve(a, b, mode=mode)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return LCAResponse(
        a=rt.to_taxon_out(result.a),
        b=rt.to_taxon_out(result.b),
        lca=rt.to_taxon_out(result.lca),
        mode=result.mode,
        steps=result.steps,
        comparisons=result.comparisons,
        naive_steps=result.naive_steps,
        path_a=result.path_a,
        path_b=result.path_b,
        trace=[JumpOut(**jump) for jump in result.trace],
    )


@app.get("/api/random-pair", response_model=PairOut)
def random_pair(
    min_lca_depth: int = Query(default=2, ge=0),
    max_lca_depth: int = Query(default=9, ge=0),
    min_depth: int = Query(default=8, ge=0, description="profundidad mínima de cada especie"),
) -> PairOut:
    """Two recognisable taxa whose common ancestor is neither trivial nor the root."""
    rt = get_runtime()
    candidates = [t for t in rt.landmarks if rt.tree.depth_of(t.id) >= min_depth]
    rng = random.Random()
    for _ in range(400):
        first, second = rng.sample(candidates, 2)
        lca_id = rt.engine.lifting.query_indexes(
            rt.tree.index_of(first.id), rt.tree.index_of(second.id)
        )
        depth = rt.tree.depth_of(rt.tree.taxon_at(lca_id).id)
        if min_lca_depth <= depth <= max_lca_depth:
            return PairOut(a=rt.to_taxon_out(first.id), b=rt.to_taxon_out(second.id))
    return PairOut(a=rt.to_taxon_out(candidates[0].id), b=rt.to_taxon_out(candidates[1].id))


# --------------------------------------------------------------------- edits


@app.post("/api/taxa", response_model=TaxonOut, status_code=201)
def create_taxon(body: CreateTaxon) -> TaxonOut:
    """Insert a new node under an existing taxon. Returns the created node."""
    rt = get_runtime()
    try:
        created = rt.add(body.name, body.parent, body.rank)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return rt.to_taxon_out(created.id)


@app.delete("/api/taxa/{taxid}", response_model=EditResult)
def delete_taxon(
    taxid: int,
    strategy: str = Query(default="reparent", pattern="^(reparent|subtree)$"),
) -> EditResult:
    """Remove a node.

    ``reparent`` keeps the branch alive by moving its children to the parent;
    ``subtree`` removes the node and everything below it.
    """
    rt = get_runtime()
    try:
        removed = rt.remove(taxid, strategy)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return EditResult(removed=removed, remaining=rt.tree.size)


@app.get("/api/edits", response_model=EditState)
def edit_state() -> EditState:
    rt = get_runtime()
    return EditState(nodes=rt.tree.size, custom=sum(1 for t in rt.taxa if t.custom))


_frontend = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _frontend.exists():  # pragma: no cover - depends on a production build
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="ui")
