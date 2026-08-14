import type { AnalyzeResult, GraphLink, GraphNode, KnowledgeGraph } from "@/lib/types";

/** Comfortable size for vis-network ForceAtlas2 + Canvas. */
export const DISPLAY_NODE_BUDGET = 3500;
export const DISPLAY_EDGE_BUDGET = 8000;

/**
 * Build a hub-and-community display subset so large graphs open quickly.
 * Keeps highest-degree nodes and fills remaining budget from largest communities.
 */
export function buildDisplaySubset(
  result: AnalyzeResult,
  maxNodes = DISPLAY_NODE_BUDGET,
  maxEdges = DISPLAY_EDGE_BUDGET,
): AnalyzeResult {
  const nodes = result.graph.nodes || [];
  const links = result.graph.links || [];
  if (nodes.length <= maxNodes) return result;

  const degree = new Map<string, number>();
  for (const e of links) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }

  const byCommunity = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const c = n.community ?? 0;
    const list = byCommunity.get(c) ?? [];
    list.push(n);
    byCommunity.set(c, list);
  }

  const rankedCommunities = [...byCommunity.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );

  const selected = new Set<string>();

  // Always keep global hubs
  const hubs = [...nodes]
    .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
    .slice(0, Math.min(400, maxNodes));
  for (const n of hubs) selected.add(n.id);

  // Fill from largest communities (prefer hubs within each)
  for (const [, members] of rankedCommunities) {
    if (selected.size >= maxNodes) break;
    const ranked = [...members].sort(
      (a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0),
    );
    const quota = Math.max(
      8,
      Math.floor((maxNodes - selected.size) / Math.max(1, rankedCommunities.length)),
    );
    for (const n of ranked.slice(0, quota)) {
      if (selected.size >= maxNodes) break;
      selected.add(n.id);
    }
  }

  // One-hop expand from hubs to keep structure readable
  for (const e of links) {
    if (selected.size >= maxNodes) break;
    if (selected.has(e.source) && !selected.has(e.target)) selected.add(e.target);
    else if (selected.has(e.target) && !selected.has(e.source)) selected.add(e.source);
  }

  const keepNodes = nodes.filter((n) => selected.has(n.id));
  const keepIds = new Set(keepNodes.map((n) => n.id));
  const keepLinks = links
    .filter((e) => keepIds.has(e.source) && keepIds.has(e.target))
    .slice(0, maxEdges);

  const graph: KnowledgeGraph = {
    ...result.graph,
    nodes: keepNodes,
    links: keepLinks,
  };

  return {
    ...result,
    graph,
    summary: {
      ...result.summary,
      node_count: keepNodes.length,
      edge_count: keepLinks.length,
      community_count: new Set(keepNodes.map((n) => n.community ?? 0)).size,
    },
    meta: {
      ...(result.meta || {}),
      display_subset: true,
      full_node_count: nodes.length,
      full_edge_count: links.length,
    },
  };
}

export function isLargeGraph(nodeCount: number | undefined | null): boolean {
  return (nodeCount ?? 0) > DISPLAY_NODE_BUDGET;
}
