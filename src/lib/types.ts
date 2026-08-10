export type GraphNode = {
  id: string;
  label: string;
  file_type?: string;
  source_file?: string;
  source_location?: string;
  community?: number;
  community_name?: string;
  _origin?: string;
  norm_label?: string;
};

export type GraphLink = {
  source: string;
  target: string;
  relation?: string;
  confidence?: string;
  confidence_score?: number;
  source_file?: string;
  source_location?: string;
  weight?: number;
  _origin?: string;
};

export type KnowledgeGraph = {
  directed?: boolean;
  nodes: GraphNode[];
  links: GraphLink[];
  built_at_commit?: string;
};

export type GraphSummary = {
  node_count: number;
  edge_count: number;
  community_count: number;
  confidence: Record<string, number>;
  god_nodes: { id: string; label: string; degree: number }[];
  report_excerpt?: string;
};

export type AnalyzeResult = {
  owner: string;
  repo: string;
  cached: boolean;
  graph: KnowledgeGraph;
  summary: GraphSummary;
  report?: string | null;
  meta?: Record<string, unknown>;
};

export const EXAMPLES = [
  { owner: "karpathy", repo: "nanoGPT", label: "nanoGPT" },
  { owner: "pallets", repo: "click", label: "Click" },
  { owner: "psf", repo: "requests", label: "Requests" },
  { owner: "tiangolo", repo: "fastapi", label: "FastAPI" },
  { owner: "pallets", repo: "flask", label: "Flask" },
] as const;

export const COMMUNITY_COLORS = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AC",
  "#86BCB6",
  "#F1A340",
  "#B3CDE3",
  "#CCEBC5",
  "#DECBE4",
  "#FED9A6",
];

export function parseGithubInput(input: string): { owner: string; repo: string } | null {
  const raw = input.trim().replace(/\/$/, "");
  const urlMatch = raw.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i,
  );
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/i, "") };
  }
  const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (short) return { owner: short[1], repo: short[2] };
  return null;
}
