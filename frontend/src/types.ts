export interface TaxonRow {
  id: number;
  parent: number;
  name: string;
  rank: string;
  custom: boolean;
}

export interface Taxon extends TaxonRow {
  depth: number;
}

export interface Dataset {
  rows: TaxonRow[];
  byId: Map<number, Taxon>;
  children: Map<number, number[]>;
  rootId: number;
  maxDepth: number;
}

export interface Suggestion {
  id: number;
  name: string;
  rank: string;
  depth: number;
}

export interface Jump {
  side: "a" | "b";
  source: number;
  target: number;
  power: number;
  cumulative: number;
}

export interface TaxonInfo {
  id: number;
  name: string;
  rank: string;
  depth: number;
  parent: number | null;
  custom?: boolean;
}

export interface LCAResult {
  a: TaxonInfo;
  b: TaxonInfo;
  lca: TaxonInfo;
  mode: "binary" | "naive";
  steps: number;
  comparisons: number;
  naive_steps: number;
  path_a: number[];
  path_b: number[];
  trace: Jump[];
}

export interface Meta {
  dataset: {
    source: string;
    license: string;
    generated: string;
    stats: {
      total_taxa_in_source: number;
      kept_nodes: number;
      landmarks: number;
      max_depth: number;
      ranks: Record<string, number>;
    };
  };
  tree: {
    nodes: number;
    edges: number;
    is_tree: boolean;
    root: string;
    max_depth: number;
    max_fanout: number;
  };
  lca: { levels: number; table_bytes: number; build: string; query: string };
  index: { keys: number };
  ranks: string[];
  landmarks: TaxonInfo[];
}

export interface TaxonomyPayload {
  columns: string[];
  root: number;
  nodes: [number, number, string, string, boolean][];
}
