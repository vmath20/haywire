/**
 * Graph loading + indexing for the Haywire MCP server.
 *
 * Load order for a repo's knowledge graph:
 *   1. Convex `examples:getByRepo` (public query) → storage URL with the full
 *      AnalyzeResult. Instant for prebuilt example repos.
 *   2. Backend `GET /graph/{owner}/{repo}` — the builder's disk cache.
 *   3. `POST /analyze` + poll — kicks off a fresh build (can take minutes for
 *      big repos; we poll within a budget and otherwise tell the caller to
 *      retry, remembering the job so a retry resumes instead of rebuilding).
 */

export type GraphNode = {
  id: string;
  label: string;
  file_type?: string;
  source_file?: string;
  source_location?: string;
  community?: number;
  community_name?: string;
  norm_label?: string;
  _callable?: boolean;
  _callable_class?: boolean;
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
};

type AnalyzeResult = {
  owner: string;
  repo: string;
  graph: { nodes: GraphNode[]; links: GraphLink[] };
  summary?: { node_count?: number; edge_count?: number; community_count?: number };
};

export type IndexedGraph = {
  owner: string;
  repo: string;
  nodes: GraphNode[];
  byId: Map<string, GraphNode>;
  out: Map<string, GraphLink[]>;
  inc: Map<string, GraphLink[]>;
  nodeCount: number;
  edgeCount: number;
};

const CONVEX_URL = (
  process.env.HAYWIRE_CONVEX_URL || "https://handsome-bat-11.convex.cloud"
).replace(/\/$/, "");
const API_URL = (
  process.env.HAYWIRE_API_URL || "https://haywire-omega.vercel.app/api/backend"
).replace(/\/$/, "");

/** How long a tool call is willing to wait for a fresh build. */
const BUILD_WAIT_MS = 90_000;
const CACHE_TTL_MS = 15 * 60_000;

const graphCache = new Map<string, { graph: IndexedGraph; at: number }>();
const pendingJobs = new Map<string, string>();

export class BuildPendingError extends Error {}

export function parseRepo(input: string): { owner: string; repo: string } {
  const raw = input.trim().replace(/\/$/, "");
  const urlMatch = raw.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i,
  );
  if (urlMatch) return { owner: urlMatch[1]!, repo: urlMatch[2]!.replace(/\.git$/i, "") };
  const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (short) return { owner: short[1]!, repo: short[2]! };
  throw new Error(
    `Could not parse "${input}" as a GitHub repository. Use "owner/repo" or a full GitHub URL.`,
  );
}

function indexGraph(owner: string, repo: string, result: AnalyzeResult): IndexedGraph {
  const nodes = result.graph?.nodes ?? [];
  const links = result.graph?.links ?? [];
  const byId = new Map<string, GraphNode>();
  for (const n of nodes) byId.set(n.id, n);

  const out = new Map<string, GraphLink[]>();
  const inc = new Map<string, GraphLink[]>();
  for (const l of links) {
    if (!byId.has(l.source) || !byId.has(l.target)) continue;
    if (l.source === l.target) continue;
    (out.get(l.source) ?? out.set(l.source, []).get(l.source)!).push(l);
    (inc.get(l.target) ?? inc.set(l.target, []).get(l.target)!).push(l);
  }

  return {
    owner,
    repo,
    nodes,
    byId,
    out,
    inc,
    nodeCount: nodes.length,
    edgeCount: links.length,
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function loadFromConvexExamples(
  owner: string,
  repo: string,
): Promise<AnalyzeResult | null> {
  const detail = await fetchJson<{ status?: string; value?: { graphUrl?: string | null } }>(
    `${CONVEX_URL}/api/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "examples:getByRepo",
        args: { owner, repo },
        format: "json",
      }),
    },
  );
  const graphUrl = detail?.value?.graphUrl;
  if (!graphUrl) return null;
  return await fetchJson<AnalyzeResult>(graphUrl);
}

async function loadFromBackendCache(
  owner: string,
  repo: string,
): Promise<AnalyzeResult | null> {
  return await fetchJson<AnalyzeResult>(`${API_URL}/graph/${owner}/${repo}`);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function buildViaAnalyze(owner: string, repo: string): Promise<AnalyzeResult> {
  const key = `${owner}/${repo}`;
  const deadline = Date.now() + BUILD_WAIT_MS;

  let jobId = pendingJobs.get(key);
  if (!jobId) {
    const started = await fetchJson<{ job_id: string }>(`${API_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `${owner}/${repo}`, force: false, code_only: true }),
    });
    if (!started?.job_id) {
      throw new Error(
        `Failed to start a graph build for ${key}. The Haywire backend may be unreachable.`,
      );
    }
    jobId = started.job_id;
    pendingJobs.set(key, jobId);
  }

  while (Date.now() < deadline) {
    await sleep(2500);
    const job = await fetchJson<{
      status: string;
      error?: { message?: string } | null;
    }>(`${API_URL}/jobs/${jobId}`);
    if (!job) continue;
    if (job.status === "error") {
      pendingJobs.delete(key);
      throw new Error(job.error?.message || `Graph build failed for ${key}.`);
    }
    if (job.status === "done") {
      pendingJobs.delete(key);
      const fromJob = await fetchJson<AnalyzeResult>(`${API_URL}/jobs/${jobId}/graph`);
      if (fromJob?.graph) return fromJob;
      const fromCache = await loadFromBackendCache(owner, repo);
      if (fromCache?.graph) return fromCache;
      throw new Error(`Graph build finished for ${key} but the result could not be fetched.`);
    }
  }

  throw new BuildPendingError(
    `The knowledge graph for ${key} is still being built (this can take a few minutes for ` +
      `large repositories). The build continues in the background — call this tool again ` +
      `in a minute or two.`,
  );
}

export async function loadGraph(repoInput: string): Promise<IndexedGraph> {
  const { owner, repo } = parseRepo(repoInput);
  const key = `${owner}/${repo}`;

  const cached = graphCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.graph;

  let result =
    (await loadFromConvexExamples(owner, repo)) ??
    (await loadFromBackendCache(owner, repo));
  if (!result?.graph) {
    result = await buildViaAnalyze(owner, repo);
  }

  const graph = indexGraph(owner, repo, result);
  if (!graph.nodeCount) {
    throw new Error(`The graph for ${key} is empty — the repository may have no supported code.`);
  }
  graphCache.set(key, { graph, at: Date.now() });
  return graph;
}

/* ─── symbol resolution ───────────────────────────────────────── */

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type Match = { node: GraphNode; score: number };

export function searchSymbols(g: IndexedGraph, query: string): Match[] {
  const q = query.trim();
  const ql = q.toLowerCase();
  const qn = norm(q);
  if (!qn) return [];

  const matches: Match[] = [];
  for (const node of g.nodes) {
    const label = node.label || "";
    const ll = label.toLowerCase();
    const ln = node.norm_label || norm(label);
    let score = 0;
    if (label === q) score = 120;
    else if (ll === ql) score = 110;
    else if (ln === qn) score = 100;
    else if (ll.endsWith(`.${ql}`) || ll.endsWith(`::${ql}`) || ll.endsWith(`/${ql}`))
      score = 90;
    else if (node.id === qn || norm(node.id) === qn) score = 85;
    else if (ll.startsWith(ql)) score = 70 - Math.min(20, label.length - q.length);
    else if (ll.includes(ql)) score = 55 - Math.min(20, label.length - q.length);
    else if (qn.length >= 4 && ln.includes(qn)) score = 40 - Math.min(15, ln.length - qn.length);
    if (score > 0) matches.push({ node, score });
  }
  matches.sort(
    (a, b) => b.score - a.score || a.node.label.length - b.node.label.length,
  );
  return matches;
}

export function resolveSymbol(
  g: IndexedGraph,
  query: string,
): { best: GraphNode | null; alternates: GraphNode[] } {
  const matches = searchSymbols(g, query);
  return {
    best: matches[0]?.node ?? null,
    alternates: matches.slice(1, 4).map((m) => m.node),
  };
}

/* ─── shared helpers ──────────────────────────────────────────── */

export function lineNumber(loc: string | undefined): number | null {
  if (!loc) return null;
  const m = loc.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function nodeLocation(n: GraphNode): string {
  if (!n.source_file) return "unknown";
  const line = lineNumber(n.source_location);
  return line ? `${n.source_file}:${line}` : n.source_file;
}

export function degreeOf(g: IndexedGraph, id: string): { in: number; out: number } {
  return { in: g.inc.get(id)?.length ?? 0, out: g.out.get(id)?.length ?? 0 };
}

export function nodeSummary(g: IndexedGraph, n: GraphNode) {
  const deg = degreeOf(g, n.id);
  return {
    symbol: n.label,
    location: nodeLocation(n),
    kind: n._callable_class ? "class" : n._callable ? "function" : (n.file_type ?? "symbol"),
    community: n.community_name ?? null,
    incoming_edges: deg.in,
    outgoing_edges: deg.out,
  };
}
