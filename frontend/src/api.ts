import type { LCAResult, Meta, Suggestion, TaxonomyPayload } from "./types";

const base = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const query = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
  const response = await fetch(`${base}${path}${query}`, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`API ${path} respondió ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchTaxonomy(): Promise<TaxonomyPayload> {
  return get<TaxonomyPayload>("/api/taxonomy");
}

export function fetchMeta(): Promise<Meta> {
  return get<Meta>("/api/meta");
}

export function fetchLca(a: number, b: number, mode: "binary" | "naive"): Promise<LCAResult> {
  return get<LCAResult>("/api/lca", { a, b, mode });
}

export function search(prefix: string, limit = 8): Promise<Suggestion[]> {
  return get<Suggestion[]>("/api/search", { q: prefix, limit });
}

export function randomPair(): Promise<{ a: { id: number }; b: { id: number } }> {
  return get<{ a: { id: number }; b: { id: number } }>("/api/random-pair");
}

export function createTaxon(name: string, parent: number, rank: string): Promise<{ id: number; name: string; parent: number }> {
  return send("/api/taxa", "POST", { name, parent, rank });
}

export function deleteTaxon(
  taxid: number,
  strategy: "reparent" | "subtree",
): Promise<{ removed: number; remaining: number }> {
  return send(`/api/taxa/${taxid}?strategy=${strategy}`, "DELETE");
}

async function send<T>(path: string, method: "POST" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(String((detail as { detail?: string }).detail ?? response.status));
  }
  return (await response.json()) as T;
}
