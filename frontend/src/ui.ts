import { search } from "./api";
import type { LCAResult, Suggestion } from "./types";

export const RANK_LABEL: Record<string, string> = {
  "acellular root": "Raíz acelular",
  "cellular root": "Raíz celular",
  domain: "Dominio",
  superkingdom: "Superreino",
  kingdom: "Reino",
  subkingdom: "Subreino",
  realm: "Reino viral",
  superphylum: "Superfilo",
  phylum: "Filo",
  subphylum: "Subfilo",
  superclass: "Superclase",
  class: "Clase",
  subclass: "Subclase",
  infraclass: "Infraclase",
  superorder: "Superorden",
  order: "Orden",
  suborder: "Suborden",
  infraorder: "Infraorden",
  parvorder: "Parvorden",
  superfamily: "Superfamilia",
  family: "Familia",
  subfamily: "Subfamilia",
  tribe: "Tribu",
  subtribe: "Subtribu",
  genus: "Género",
  subgenus: "Subgénero",
  species: "Especie",
  subspecies: "Subespecie",
  clade: "Clado",
  "species group": "Grupo de especies",
  "species subgroup": "Subgrupo de especies",
  "no rank": "Sin rango",
  section: "Sección",
  series: "Serie",
};

export function rankLabel(rank: string): string {
  return RANK_LABEL[rank] ?? rank.charAt(0).toUpperCase() + rank.slice(1);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-CO").format(value);
}

export function buildLegend(container: HTMLElement, ranks: string[], colors: Record<string, string>): void {
  container.replaceChildren();
  const priority = [
    "domain",
    "kingdom",
    "phylum",
    "class",
    "order",
    "family",
    "genus",
    "species",
    "clade",
  ];
  const ordered = [...priority.filter((rank) => ranks.includes(rank))];
  for (const rank of ordered) {
    const row = document.createElement("div");
    row.className = "legend__row";
    const swatch = document.createElement("span");
    swatch.className = "legend__swatch";
    swatch.style.background = colors[rank] ?? "#9aa3ae";
    swatch.style.boxShadow = `0 0 12px ${colors[rank] ?? "#9aa3ae"}66`;
    const label = document.createElement("span");
    label.textContent = rankLabel(rank);
    row.append(swatch, label);
    container.append(row);
  }
}

export function renderResult(result: LCAResult): void {
  const set = (id: string, text: string): void => {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  };

  set("result-eyebrow", `Ancestro común de ${result.a.name} y ${result.b.name}`);
  set("result-name", result.lca.name);
  set("result-rank", rankLabel(result.lca.rank));
  set("result-depth", `nivel ${result.lca.depth}`);
  set("stat-steps", String(result.steps));
  set("stat-naive", String(result.naive_steps));

  const ratio = result.steps > 0 ? result.naive_steps / result.steps : 1;
  set("stat-ratio", ratio >= 1.05 ? `${ratio.toFixed(1)}×` : "—");

  const fill = document.getElementById("bar-fill");
  if (fill) {
    const fraction = result.naive_steps > 0 ? Math.min(1, result.steps / result.naive_steps) : 1;
    fill.style.width = `${Math.max(6, fraction * 100)}%`;
  }

  const mode = result.mode === "binary" ? "saltos binarios" : "subida paso a paso";
  set(
    "result-note",
    result.mode === "binary"
      ? `Con ${mode}: ${result.steps} saltos frente a ${result.naive_steps} pasos sin optimizar. Cada salto recorre una potencia de dos ancestros.`
      : `Sin optimizar se necesitan ${result.naive_steps} pasos de una arista. El modo optimizado resuelve lo mismo en ${result.steps} saltos.`,
  );
}

export class Autocomplete {
  private timer: number | undefined;
  private token = 0;
  private items: Suggestion[] = [];
  private active = -1;

  constructor(
    private readonly input: HTMLInputElement,
    private readonly menu: HTMLElement,
    private readonly onSelect: (suggestion: Suggestion) => void,
  ) {
    this.input.addEventListener("input", this.onInput);
    this.input.addEventListener("keydown", this.onKeyDown);
    this.input.addEventListener("blur", () => {
      window.setTimeout(() => this.close(), 140);
    });
    this.input.addEventListener("focus", () => {
      if (this.items.length > 0) this.open();
    });
  }

  setValue(suggestion: Suggestion): void {
    this.input.value = suggestion.name;
    this.close();
  }

  private onInput = (): void => {
    window.clearTimeout(this.timer);
    const value = this.input.value.trim();
    if (value.length < 2) {
      this.close();
      return;
    }
    this.timer = window.setTimeout(async () => {
      const token = ++this.token;
      try {
        const results = await search(value, 7);
        if (token !== this.token) return;
        this.items = results;
        this.active = -1;
        this.render();
      } catch {
        this.close();
      }
    }, 110);
  };

  private render(): void {
    this.menu.replaceChildren();
    if (this.items.length === 0) {
      this.close();
      return;
    }
    this.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `suggestion${index === this.active ? " is-active" : ""}`;
      button.setAttribute("role", "option");
      button.innerHTML = `<span class="suggestion__name">${escapeHtml(item.name)}</span><span class="suggestion__rank">${rankLabel(item.rank)}</span>`;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.choose(index);
      });
      this.menu.append(button);
    });
    this.open();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (this.items.length === 0) return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      this.active = (this.active + direction + this.items.length) % this.items.length;
      this.render();
      return;
    }
    if (event.key === "Enter" && this.active >= 0) {
      event.preventDefault();
      this.choose(this.active);
      return;
    }
    if (event.key === "Escape") {
      this.close();
    }
  };

  private choose(index: number): void {
    const item = this.items[index];
    if (!item) return;
    this.input.value = item.name;
    this.onSelect(item);
    this.close();
  }

  private open(): void {
    this.menu.classList.add("is-open");
  }

  private close(): void {
    this.menu.classList.remove("is-open");
    this.menu.replaceChildren();
    this.items = [];
    this.active = -1;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[character] ?? character;
  });
}
