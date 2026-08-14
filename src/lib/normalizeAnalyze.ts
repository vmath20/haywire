import type { AnalyzeResult, KnowledgeGraph } from "@/lib/types";

/** Accept either a full AnalyzeResult or a raw knowledge graph JSON. */
export function normalizeAnalyzePayload(
  raw: unknown,
  meta: {
    owner: string;
    repo: string;
    nodeCount?: number;
    edgeCount?: number;
    communityCount?: number;
    report?: string | null;
  },
): AnalyzeResult {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (
      obj.graph &&
      typeof obj.graph === "object" &&
      Array.isArray((obj.graph as { nodes?: unknown }).nodes) &&
      obj.summary &&
      typeof obj.summary === "object"
    ) {
      return obj as unknown as AnalyzeResult;
    }
    if (Array.isArray(obj.nodes) && Array.isArray(obj.links)) {
      const graph = obj as unknown as KnowledgeGraph;
      return {
        owner: meta.owner,
        repo: meta.repo,
        cached: true,
        graph,
        summary: {
          node_count: meta.nodeCount ?? graph.nodes.length,
          edge_count: meta.edgeCount ?? graph.links.length,
          community_count: meta.communityCount ?? 0,
          confidence: {},
          god_nodes: [],
        },
        report: meta.report ?? null,
        meta: {},
      };
    }
  }
  throw new Error("Unrecognized graph payload");
}
