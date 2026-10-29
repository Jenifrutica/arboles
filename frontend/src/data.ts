import type { Dataset, TaxonomyPayload, TaxonRow } from "./types";

/** Turn the flat wire payload into lookup structures the renderer can walk. */
export function buildDataset(payload: TaxonomyPayload): Dataset {
  const rows: TaxonRow[] = payload.nodes.map(([id, parent, name, rank, custom]) => ({
    id,
    parent,
    name,
    rank,
    custom: Boolean(custom),
  }));
  const byId = new Map<number, import("./types").Taxon>();
  const children = new Map<number, number[]>();

  for (const row of rows) {
    byId.set(row.id, { ...row, depth: 0 });
  }

  for (const row of rows) {
    if (row.parent === 0) {
      continue;
    }
    const bucket = children.get(row.parent);
    if (bucket) {
      bucket.push(row.id);
    } else {
      children.set(row.parent, [row.id]);
    }
  }

  const rootId = payload.root;
  const queue: number[] = [rootId];
  let maxDepth = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    const node = byId.get(id);
    if (!node) {
      continue;
    }
    maxDepth = Math.max(maxDepth, node.depth);
    for (const child of children.get(id) ?? []) {
      const childNode = byId.get(child);
      if (childNode) {
        childNode.depth = node.depth + 1;
        queue.push(child);
      }
    }
  }

  return { rows, byId, children, rootId, maxDepth };
}

/** Small deterministic hash, used for stable visual jitter per node. */
export function hash(id: number): number {
  let x = id ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}
