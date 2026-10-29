import { hash } from "./data";
import type { Dataset } from "./types";

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Layout {
  positions: Map<number, Point>;
  visible: number[];
  edges: [number, number][];
  visibleChildren: Map<number, number[]>;
}

const RADIUS_BASE = 5.4;
const RADIUS_EXPONENT = 0.68;
const TAU = Math.PI * 2;

function radiusAt(depth: number): number {
  return RADIUS_BASE * Math.pow(depth, RADIUS_EXPONENT);
}

/**
 * Radial three-dimensional layout.
 *
 * Every node owns an angular sector inherited from its parent; the sector is
 * split among children proportionally to how many visible leaves hang from each
 * one. Radius grows with depth (sub-linearly, so deep lineages do not fly off
 * screen), which yields the "tree of life" fan instead of a lopsided 2D
 * dendrogram.
 *
 * Visibility is level-of-detail: a child is drawn when the view is still within
 * ``baseDepth`` or when its parent has been manually expanded. That is what
 * keeps 25k taxa readable at 300 nodes on screen.
 */
export function computeLayout(
  dataset: Dataset,
  expanded: Set<number>,
  baseDepth: number,
  forced: Set<number> = new Set(),
): Layout {
  const visible: number[] = [dataset.rootId];
  const visibleChildren = new Map<number, number[]>();
  const seen = new Set<number>([dataset.rootId]);

  for (let cursor = 0; cursor < visible.length; cursor += 1) {
    const id = visible[cursor];
    const node = dataset.byId.get(id);
    if (!node) {
      continue;
    }
    const childDepth = node.depth + 1;
    const open = childDepth <= baseDepth || expanded.has(id);
    for (const child of dataset.children.get(id) ?? []) {
      if (seen.has(child)) {
        continue;
      }
      const childNode = dataset.byId.get(child);
      if (!childNode) {
        continue;
      }
      if (!open && !forced.has(child)) {
        continue;
      }
      seen.add(child);
      visible.push(child);
      const bucket = visibleChildren.get(id);
      if (bucket) {
        bucket.push(child);
      } else {
        visibleChildren.set(id, [child]);
      }
    }
  }

  // Subtree weights, computed in reverse breadth-first order (children always
  // come after their parent in ``visible``).
  const weight = new Map<number, number>();
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const id = visible[index];
    const kids = visibleChildren.get(id);
    if (!kids || kids.length === 0) {
      weight.set(id, 1);
      continue;
    }
    let total = 0;
    for (const kid of kids) {
      total += weight.get(kid) ?? 1;
    }
    weight.set(id, total);
  }

  const positions = new Map<number, Point>();
  const root = dataset.byId.get(dataset.rootId);
  positions.set(dataset.rootId, { x: 0, y: 0, z: 0 });

  const stack: Array<{ id: number; start: number; end: number; depth: number }> = [
    { id: dataset.rootId, start: 0, end: TAU, depth: root?.depth ?? 0 },
  ];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const kids = visibleChildren.get(current.id) ?? [];
    const parentWeight = weight.get(current.id) ?? 1;
    let cursor = current.start;
    const span = current.end - current.start;

    for (const kid of kids) {
      const share = ((weight.get(kid) ?? 1) / parentWeight) * span;
      const padding = kids.length > 1 ? Math.min(share * 0.16, 0.09) : 0;
      const angle = cursor + share / 2;
      const depth = current.depth + 1;
      const radius = radiusAt(depth);
      const wobble = hash(kid) - 0.5;

      positions.set(kid, {
        x: Math.cos(angle) * radius + wobble * 0.35,
        y: Math.sin(angle * 2 + depth * 0.55) * (0.35 + depth * 0.14) + wobble * 0.25,
        z: Math.sin(angle) * radius + wobble * 0.35,
      });
      stack.push({ id: kid, start: cursor + padding, end: cursor + share - padding, depth });
      cursor += share;
    }
  }

  const edges: [number, number][] = [];
  for (const [parent, kids] of visibleChildren) {
    for (const kid of kids) {
      edges.push([parent, kid]);
    }
  }

  return { positions, visible, edges, visibleChildren };
}
