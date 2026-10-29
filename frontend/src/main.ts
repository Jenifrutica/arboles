import "@fontsource-variable/fraunces";
import "@fontsource-variable/inter";
import "./styles.css";

import gsap from "gsap";

import { createTaxon, deleteTaxon, fetchLca, fetchMeta, fetchTaxonomy, randomPair } from "./api";
import { buildDataset } from "./data";
import { computeLayout } from "./layout";
import { RANK_STYLE, TreeScene, type HeroSpec } from "./scene";
import type { Dataset, LCAResult } from "./types";
import { Autocomplete, buildLegend, formatNumber, rankLabel, renderResult } from "./ui";

const BASE_DEPTH = 3;

const RANK_OPTIONS = [
  ["clade", "Clado"],
  ["domain", "Dominio"],
  ["kingdom", "Reino"],
  ["phylum", "Filo"],
  ["class", "Clase"],
  ["order", "Orden"],
  ["family", "Familia"],
  ["genus", "Género"],
  ["species", "Especie"],
];

interface State {
  dataset: Dataset | null;
  mode: "binary" | "naive";
  slotA: number | null;
  slotB: number | null;
  selected: number | null;
  expanded: Set<number>;
  forced: Set<number>;
  pinned: Set<number>;
  last: LCAResult | null;
  busy: boolean;
  modalMode: "add" | "delete";
}

const state: State = {
  dataset: null,
  mode: "binary",
  slotA: null,
  slotB: null,
  selected: null,
  expanded: new Set(),
  forced: new Set(),
  pinned: new Set(),
  last: null,
  busy: false,
  modalMode: "add",
};

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`falta el elemento #${id}`);
  return element as T;
};

const stage = $("stage");
const scene = new TreeScene(stage);

const inputA = $<HTMLInputElement>("input-a");
const inputB = $<HTMLInputElement>("input-b");
const resultPanel = $("result-panel");
const tooltip = $("tooltip");
const loader = $("loader");
const hint = $("query-hint");
const nodebar = $("nodebar");
const modal = $("modal");
const toastElement = $("toast");

// ---------------------------------------------------------------- helpers

function relayout(): void {
  if (!state.dataset) return;
  const visible = new Set([...state.forced, ...state.pinned]);
  const layout = computeLayout(state.dataset, state.expanded, BASE_DEPTH, visible);
  scene.setLayout(layout);
}

function setSlot(slot: "a" | "b", taxid: number): void {
  const node = state.dataset?.byId.get(taxid);
  if (!node) return;
  if (slot === "a") {
    state.slotA = taxid;
    inputA.value = node.name;
  } else {
    state.slotB = taxid;
    inputB.value = node.name;
  }
  updateHint();
}

function nextSlot(): "a" | "b" {
  if (state.slotA === null) return "a";
  if (state.slotB === null) return "b";
  return "a";
}

function updateHint(): void {
  if (!hint) return;
  if (state.slotA === null && state.slotB === null) {
    hint.textContent = "Elige dos especies: búscalas o haz clic sobre los nodos del árbol.";
    return;
  }
  if (state.slotA === null || state.slotB === null) {
    hint.textContent = "Falta una especie. Escribe un nombre o toca un nodo con forma de especie.";
    return;
  }
  hint.textContent = "Listo. Enter para resolver el ancestro común.";
}

function toast(message: string): void {
  toastElement.textContent = message;
  toastElement.classList.add("is-visible");
  window.setTimeout(() => toastElement.classList.remove("is-visible"), 2600);
}

function showResultPanel(): void {
  resultPanel.classList.remove("is-hidden");
  gsap.fromTo(
    resultPanel,
    { opacity: 0, y: 18, scale: 0.985 },
    { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out" },
  );
}

function hideResultPanel(): void {
  resultPanel.classList.add("is-hidden");
}

// --------------------------------------------------------------- node bar

function renderNodeBar(): void {
  const dataset = state.dataset;
  if (!dataset || state.selected === null) {
    nodebar.classList.add("is-hidden");
    return;
  }
  const node = dataset.byId.get(state.selected);
  if (!node) {
    nodebar.classList.add("is-hidden");
    return;
  }
  const children = dataset.children.get(node.id)?.length ?? 0;
  $("nodebar-rank").textContent = node.custom ? `${rankLabel(node.rank)} · creado por ti` : rankLabel(node.rank);
  $("nodebar-name").textContent = node.name;
  $("nodebar-meta").textContent = `nivel ${node.depth} · ${children} ${children === 1 ? "rama" : "ramas"}`;
  $<HTMLButtonElement>("delete-node-btn").disabled = node.parent === 0;
  nodebar.classList.remove("is-hidden");
  gsap.fromTo(nodebar, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: "power2.out" });
}

function selectNode(taxid: number | null): void {
  state.selected = taxid;
  renderNodeBar();
}

// ------------------------------------------------------------------ boot

async function boot(): Promise<void> {
  try {
    const [meta, payload] = await Promise.all([fetchMeta(), fetchTaxonomy()]);
    const dataset = buildDataset(payload);
    state.dataset = dataset;

    scene.setDataset(dataset);
    relayout();

    $("taxon-count").textContent = `${formatNumber(meta.tree.nodes)} taxones · ${formatNumber(meta.tree.edges)} ramas`;
    $("kept-count").textContent = formatNumber(meta.dataset.stats.kept_nodes);

    const colors: Record<string, string> = {};
    for (const [rank, style] of Object.entries(RANK_STYLE)) {
      colors[rank] = `#${style.color.toString(16).padStart(6, "0")}`;
    }
    buildLegend($("legend-body"), Object.keys(colors), colors);

    const heroes: HeroSpec[] = [
      { taxid: 1, url: "/assets/hero/dna.glb", scale: 2.6, offsetY: 5.4, push: 0 },
      { taxid: 2, url: "/assets/hero/bacteria.glb", scale: 2.2, push: 2.0 },
      { taxid: 4751, url: "/assets/hero/fungi.glb", scale: 1.9, push: 2.8 },
      { taxid: 33090, url: "/assets/hero/plant.glb", scale: 1.9, push: 2.6, offsetY: 1.4 },
      { taxid: 33208, url: "/assets/hero/beetle.glb", scale: 1.9, push: 2.4 },
      // Los dos especímenes que viven en ramas demasiado profundas se exponen
      // en la galería frontal, para que siempre estén a la vista.
      { url: "/assets/hero/shell.glb", scale: 1.9, fixed: { x: -10.5, y: -5.6, z: 11 } },
      { url: "/assets/hero/human.glb", scale: 1.7, fixed: { x: 10.5, y: -5.6, z: 11 } },
    ].filter((spec) => spec.taxid === undefined || dataset.byId.has(spec.taxid));

    void scene.loadHeroes(heroes);

    // Pre-filled so the first click is the whole demo.
    if (dataset.byId.has(9606) && dataset.byId.has(41956)) {
      setSlot("a", 9606);
      setSlot("b", 41956);
    }

    setSlot("a", 9606);
    setSlot("b", 41956);
    selectNode(2);

    loader.classList.add("is-hidden");
    updateHint();
  } catch (error) {
    console.error(error);
    $("loader-text").textContent =
      "No se pudo cargar la API. Arranca el backend en el puerto 8000 y recarga.";
  }
}

// -------------------------------------------------------------- interaction

scene.onPick = (taxid) => {
  const dataset = state.dataset;
  if (!dataset) return;
  const node = dataset.byId.get(taxid);
  if (!node) return;

  selectNode(taxid);

  const children = dataset.children.get(taxid)?.length ?? 0;
  if (children > 0) {
    if (state.expanded.has(taxid)) {
      state.expanded.delete(taxid);
    } else {
      state.expanded.add(taxid);
    }
    relayout();
    state.selected = taxid;
    renderNodeBar();
  }

  const isPickable = children === 0 || node.rank === "species" || node.rank === "subspecies";
  if (isPickable) {
    setSlot(nextSlot(), taxid);
  }
};

scene.onHover = (taxid, x, y) => {
  if (taxid === null) {
    tooltip.classList.remove("is-visible");
    return;
  }
  const node = state.dataset?.byId.get(taxid);
  if (!node) return;
  const children = state.dataset?.children.get(taxid)?.length ?? 0;
  tooltip.innerHTML = `
    <strong>${node.name}</strong>
    <span>${rankLabel(node.rank)} · nivel ${node.depth}</span>
    <em>${children > 0 ? `${children} ramas · clic para desplegar` : "especie · clic para elegir"}</em>
  `;
  tooltip.style.transform = `translate(${x + 16}px, ${y + 14}px)`;
  tooltip.classList.add("is-visible");
};

new Autocomplete(inputA, $("menu-a"), (suggestion) => {
  state.slotA = suggestion.id;
  updateHint();
});
new Autocomplete(inputB, $("menu-b"), (suggestion) => {
  state.slotB = suggestion.id;
  updateHint();
});

for (const button of document.querySelectorAll<HTMLButtonElement>(".mode")) {
  button.addEventListener("click", () => {
    state.mode = (button.dataset.mode as "binary" | "naive") ?? "binary";
    for (const other of document.querySelectorAll(".mode")) {
      other.classList.toggle("is-active", other === button);
    }
  });
}

async function run(): Promise<void> {
  if (!state.dataset || state.busy) return;
  if (state.slotA === null || state.slotB === null) {
    updateHint();
    gsap.fromTo("#query-panel", { x: -6 }, { x: 0, duration: 0.4, ease: "elastic.out(1, 0.4)" });
    return;
  }
  if (state.slotA === state.slotB) {
    hint.textContent = "Elige dos especies distintas.";
    return;
  }

  state.busy = true;
  const runButton = $<HTMLButtonElement>("run-btn");
  runButton.disabled = true;
  try {
    const result = await fetchLca(state.slotA, state.slotB, state.mode);
    state.last = result;
    state.forced = new Set([...result.path_a, ...result.path_b]);
    relayout();
    renderResult(result);
    showResultPanel();
    await scene.playClimb(result, result.mode === "naive" ? 2.1 : 1);
  } catch (error) {
    console.error(error);
    hint.textContent = "No se pudo calcular. Revisa que el backend siga en pie.";
  } finally {
    state.busy = false;
    runButton.disabled = false;
  }
}

$("run-btn").addEventListener("click", () => void run());
inputA.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void run();
});
inputB.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void run();
});

$("random-btn").addEventListener("click", async () => {
  try {
    const pair = await randomPair();
    state.slotA = pair.a.id;
    state.slotB = pair.b.id;
    inputA.value = state.dataset?.byId.get(pair.a.id)?.name ?? "";
    inputB.value = state.dataset?.byId.get(pair.b.id)?.name ?? "";
    updateHint();
    await run();
  } catch (error) {
    console.error(error);
  }
});

$("replay-btn").addEventListener("click", () => {
  if (state.last) void scene.playClimb(state.last, 1);
});

$("close-btn").addEventListener("click", () => {
  hideResultPanel();
  state.forced.clear();
  scene.clearHighlights();
  relayout();
});

$("legend-toggle").addEventListener("click", () => {
  $("legend").classList.toggle("is-open");
});

// ------------------------------------------------------------ editing nodes

function openModal(mode: "add" | "delete"): void {
  const dataset = state.dataset;
  if (!dataset || state.selected === null) return;
  const node = dataset.byId.get(state.selected);
  if (!node) return;

  state.modalMode = mode;
  const title = $("modal-title");
  const sub = $("modal-sub");
  const body = $("modal-body");
  const confirm = $<HTMLButtonElement>("modal-confirm");

  if (mode === "add") {
    title.textContent = "Añadir rama";
    sub.textContent = `Se insertará un nodo hijo de “${node.name}”. La tabla de saltos se recalcula al instante.`;
    body.innerHTML = `
      <label class="field field--plain">
        <span class="field__label">Nombre del nuevo taxón</span>
        <input id="modal-name" type="text" maxlength="80" placeholder="Ej. Cristalavirus" />
      </label>
      <label class="field field--plain">
        <span class="field__label">Rango</span>
        <select id="modal-rank">
          ${RANK_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
        </select>
      </label>
    `;
    confirm.textContent = "Crear rama";
    confirm.classList.remove("ghost--danger");
    window.setTimeout(() => $<HTMLInputElement>("modal-name").focus(), 60);
  } else {
    const children = dataset.children.get(node.id)?.length ?? 0;
    title.textContent = "Eliminar nodo";
    sub.textContent =
      children > 0
        ? `“${node.name}” tiene ${children} ${children === 1 ? "rama" : "ramas"}. Decide qué pasa con ellas.`
        : `“${node.name}” no tiene descendientes; se eliminará directamente.`;
    body.innerHTML = `
      <label class="choice is-active">
        <input type="radio" name="strategy" value="reparent" checked ${children === 0 ? "disabled" : ""} />
        <span>
          <strong>Reenganchar sus ramas</strong>
          Las ramas suben al padre del nodo. La estructura sigue siendo un árbol.
        </span>
      </label>
      <label class="choice">
        <input type="radio" name="strategy" value="subtree" />
        <span>
          <strong>Eliminar todo el subárbol</strong>
          Se borran el nodo y sus ${children} descendientes directos.
        </span>
      </label>
    `;
    for (const choice of body.querySelectorAll<HTMLInputElement>("input[name=strategy]")) {
      choice.addEventListener("change", () => {
        for (const label of body.querySelectorAll(".choice")) label.classList.remove("is-active");
        choice.closest(".choice")?.classList.add("is-active");
      });
    }
    confirm.textContent = "Eliminar";
    confirm.classList.add("ghost--danger");
  }

  modal.classList.add("is-open");
}

function closeModal(): void {
  modal.classList.remove("is-open");
}

$("add-child-btn").addEventListener("click", () => openModal("add"));
$("delete-node-btn").addEventListener("click", () => openModal("delete"));
$("modal-close").addEventListener("click", closeModal);
$("modal-cancel").addEventListener("click", closeModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

async function refreshTree(message?: string): Promise<void> {
  const payload = await fetchTaxonomy();
  const dataset = buildDataset(payload);
  state.dataset = dataset;
  scene.setDataset(dataset);
  relayout();
  renderNodeBar();
  $("taxon-count").textContent = `${formatNumber(dataset.byId.size)} taxones · ${formatNumber(dataset.byId.size - 1)} ramas`;
  if (message) toast(message);
}

$("modal-confirm").addEventListener("click", async () => {
  const dataset = state.dataset;
  if (!dataset || state.selected === null) return;
  const parentId = state.selected;

  try {
    if (state.modalMode === "add") {
      const name = $<HTMLInputElement>("modal-name").value.trim();
      const rank = $<HTMLSelectElement>("modal-rank").value;
      if (!name) {
        toast("Ponle un nombre al nuevo taxón.");
        return;
      }
      const created = await createTaxon(name, parentId, rank);
      closeModal();
      state.expanded.add(parentId);
      state.selected = created.id;
      await refreshTree(`Rama “${created.name}” añadida.`);
      scene.flyTo(created.id, 8);
    } else {
      const choice = document.querySelector<HTMLInputElement>("input[name=strategy]:checked");
      const strategy = (choice?.value ?? "reparent") as "reparent" | "subtree";
      const removed = await deleteTaxon(parentId, strategy);
      closeModal();
      state.expanded.delete(parentId);
      state.forced.delete(parentId);
      if (state.slotA === parentId) {
        state.slotA = null;
        inputA.value = "";
      }
      if (state.slotB === parentId) {
        state.slotB = null;
        inputB.value = "";
      }
      state.selected = null;
      hideResultPanel();
      state.last = null;
      await refreshTree(
        removed.removed > 1 ? `${removed.removed} nodos eliminados.` : "Nodo eliminado.",
      );
      updateHint();
    }
  } catch (error) {
    console.error(error);
    toast(String((error as Error).message ?? "No se pudo editar el árbol."));
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (modal.classList.contains("is-open")) {
      closeModal();
      return;
    }
    hideResultPanel();
    selectNode(null);
    state.forced.clear();
    scene.clearHighlights();
    relayout();
  }
});

// Hook de depuración y de las pruebas de humo.
(window as unknown as { __arbol: unknown }).__arbol = { scene, state, relayout };

void boot();
