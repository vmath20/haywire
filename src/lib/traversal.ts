export type TraversalStep = {
  id: string;
  label: string;
  depth: number;
  seed?: boolean;
  sourceFile?: string | null;
};

export type TraversalPath = {
  mode: string;
  depth?: number;
  seeds: string[];
  visitOrder: TraversalStep[];
  edges: { from: string; to: string }[];
  nodeCount?: number;
};

/** Normalize backend snake_case traversal into frontend camelCase. */
export function normalizeTraversal(raw: unknown): TraversalPath | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const visitRaw = (t.visit_order ?? t.visitOrder) as unknown;
  const edgesRaw = t.edges as unknown;
  if (!Array.isArray(visitRaw) || visitRaw.length === 0) return null;

  const visitOrder: TraversalStep[] = visitRaw
    .map((step) => {
      if (!step || typeof step !== "object") return null;
      const s = step as Record<string, unknown>;
      const id = String(s.id ?? "");
      if (!id) return null;
      return {
        id,
        label: String(s.label ?? id),
        depth: Number(s.depth ?? 0),
        seed: Boolean(s.seed),
        sourceFile:
          typeof s.source_file === "string"
            ? s.source_file
            : typeof s.sourceFile === "string"
              ? s.sourceFile
              : null,
      };
    })
    .filter(Boolean) as TraversalStep[];

  const edges = Array.isArray(edgesRaw)
    ? edgesRaw
        .map((e) => {
          if (!e || typeof e !== "object") return null;
          const edge = e as Record<string, unknown>;
          const from = String(edge.from ?? "");
          const to = String(edge.to ?? "");
          if (!from || !to) return null;
          return { from, to };
        })
        .filter(Boolean) as { from: string; to: string }[]
    : [];

  const seeds = Array.isArray(t.seeds) ? t.seeds.map(String) : [];

  return {
    mode: String(t.mode ?? "bfs"),
    depth: typeof t.depth === "number" ? t.depth : undefined,
    seeds,
    visitOrder,
    edges,
    nodeCount: typeof t.node_count === "number" ? t.node_count : visitOrder.length,
  };
}
