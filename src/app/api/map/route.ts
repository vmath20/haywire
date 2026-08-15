import { NextRequest } from "next/server";
import { apiUrl } from "@/lib/api";
import { normalizeSpec, MAP_GRID_W, MAP_GRID_H } from "@/lib/systemMap";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  owner: string;
  repo: string;
  graph_url?: string | null;
};

type GraphNode = {
  id: string;
  label: string;
  source_file?: string;
  source_location?: string;
  community_name?: string;
};

type GraphLink = {
  source: string;
  target: string;
  relation?: string;
};

type AnalyzeResult = {
  graph: { nodes: GraphNode[]; links: GraphLink[] };
  summary?: { node_count?: number; edge_count?: number; community_count?: number };
};

const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL?.trim() || "moonshotai/kimi-k2.6";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Resolve FastAPI base URL without using protected VERCEL_URL hosts. */
function backendBase(req: NextRequest): string {
  const configured = (
    process.env.HAYWIRE_API_URL ||
    process.env.NEXT_PUBLIC_HAYWIRE_API_URL ||
    ""
  ).replace(/\/$/, "");
  if (configured) return configured;

  const prodHost = (
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "haywire-omega.vercel.app"
  )
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  if (process.env.VERCEL) return `https://${prodHost}/api/backend`;
  return `${req.nextUrl.origin}${apiUrl("").replace(/\/$/, "")}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Load the repo graph: explicit URL → backend disk cache → fresh analyze
 * build polled within the request budget. Returns null when the build is
 * still running (caller responds 202 so the client can retry).
 */
async function loadGraph(
  req: NextRequest,
  owner: string,
  repo: string,
  graphUrl?: string | null,
): Promise<AnalyzeResult | null | "building"> {
  if (graphUrl) {
    const fromUrl = await fetchJson<AnalyzeResult>(graphUrl);
    if (fromUrl?.graph?.nodes?.length) return fromUrl;
  }

  const base = backendBase(req);
  const cached = await fetchJson<AnalyzeResult>(`${base}/graph/${owner}/${repo}`);
  if (cached?.graph?.nodes?.length) return cached;

  const started = await fetchJson<{ job_id?: string }>(`${base}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `${owner}/${repo}`, force: false, code_only: true }),
  });
  if (!started?.job_id) return null;

  const deadline = Date.now() + 220_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const job = await fetchJson<{ status?: string; error?: { message?: string } | null }>(
      `${base}/jobs/${started.job_id}`,
    );
    if (!job) continue;
    if (job.status === "error") {
      throw new Error(job.error?.message || `Graph build failed for ${owner}/${repo}`);
    }
    if (job.status === "done") {
      const fromJob = await fetchJson<AnalyzeResult>(`${base}/jobs/${started.job_id}/graph`);
      if (fromJob?.graph?.nodes?.length) return fromJob;
      const fromCache = await fetchJson<AnalyzeResult>(`${base}/graph/${owner}/${repo}`);
      if (fromCache?.graph?.nodes?.length) return fromCache;
      return null;
    }
  }
  return "building";
}

/**
 * Compress the graph to a file-level summary the LLM can reason about:
 * top files with their most-connected symbols, plus aggregated
 * file-to-file dependency edges.
 */
function summarizeGraph(result: AnalyzeResult): string {
  const nodes = result.graph.nodes ?? [];
  const links = result.graph.links ?? [];

  const fileOf = new Map<string, string>();
  const degree = new Map<string, number>();
  for (const n of nodes) {
    fileOf.set(n.id, n.source_file || n.community_name || "misc");
  }
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }

  type FileInfo = {
    nodes: number;
    degree: number;
    symbols: { label: string; degree: number }[];
  };
  const files = new Map<string, FileInfo>();
  for (const n of nodes) {
    const file = fileOf.get(n.id)!;
    const info = files.get(file) ?? { nodes: 0, degree: 0, symbols: [] };
    const d = degree.get(n.id) ?? 0;
    info.nodes += 1;
    info.degree += d;
    info.symbols.push({ label: n.label, degree: d });
    files.set(file, info);
  }

  const fileEdges = new Map<string, { count: number; relation: string }>();
  for (const l of links) {
    const a = fileOf.get(l.source);
    const b = fileOf.get(l.target);
    if (!a || !b || a === b) continue;
    const key = `${a} -> ${b}`;
    const e = fileEdges.get(key) ?? { count: 0, relation: l.relation || "uses" };
    e.count += 1;
    fileEdges.set(key, e);
  }

  const topFiles = [...files.entries()]
    .sort((a, b) => b[1].degree - a[1].degree)
    .slice(0, 42);

  const lines: string[] = [];
  lines.push(
    `GRAPH SUMMARY: ${nodes.length} symbols, ${links.length} edges, ${files.size} files.`,
    "",
    "FILES (path | symbols | connectivity | top symbols):",
  );
  for (const [path, info] of topFiles) {
    const top = info.symbols
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 7)
      .map((s) => s.label)
      .join(", ");
    lines.push(`- ${path} | ${info.nodes} symbols | degree ${info.degree} | ${top}`);
  }

  lines.push("", "FILE DEPENDENCIES (from -> to | edge count | relation):");
  const topEdges = [...fileEdges.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 90);
  for (const [key, e] of topEdges) {
    lines.push(`- ${key} | ${e.count} | ${e.relation}`);
  }

  let text = lines.join("\n");
  if (text.length > 14_000) text = text.slice(0, 14_000);
  return text;
}

function buildPrompt(owner: string, repo: string, summary: string): string {
  return `You are a systems cartographer. From the code-graph summary of the GitHub repository ${owner}/${repo}, design an isometric "system map": the repo's runtime architecture as buildings on a grid, with flows tracing real control/data paths.

${summary}

Return ONLY a JSON object with this exact shape (no markdown fences, no commentary):

{
  "title": "Editorial title for the system, e.g. 'The Evolution Harness'",
  "tagline": "One line: what a run of this system does",
  "what": "2-4 sentences: what this repository IS and what happens when it runs. Plain language, no jargon dumps.",
  "how": "2-4 sentences: how it is implemented — languages, key architectural choices, where the hard problems live.",
  "categories": [
    { "id": "entry", "label": "Entry and control" }
  ],
  "modules": [
    {
      "id": "CM",
      "name": "CLI / MCP",
      "category": "entry",
      "what": "1-2 sentences, plain language: what this module does at runtime.",
      "how": "1-2 sentences: how it's built (key files, patterns, libraries).",
      "files": ["path/from/summary.py"],
      "stack": 3,
      "size": 1,
      "x": 2,
      "y": 1
    }
  ],
  "flows": [
    {
      "id": "generation-loop",
      "name": "Generation loop",
      "tagline": "Candidate → evaluation → durable knowledge → next generation",
      "what": "2-3 sentences explaining what moves through this flow and why.",
      "payload": "GenerationContext",
      "sources": ["cli_solve.py", "mcp/server.py"],
      "steps": [
        { "from": "CM", "to": "RL", "kind": "flow" },
        { "from": "RL", "to": "KN", "kind": "flow" }
      ]
    }
  ],
  "stats": [
    { "label": "Runtime flows", "value": "4" },
    { "label": "Active modules", "value": "9" }
  ]
}

Rules:
- 8 to 14 modules. Each is a REAL subsystem inferred from the files (group related files). Module ids are 1-3 uppercase letters, all unique.
- 3 or 4 categories that tell a story, e.g. "The system", "The evolution loop", "What comes out" — adapt to THIS repo.
- Every module's "files" must cite real paths from the summary. Never invent paths.
- "stack" (1-6) = how much machinery lives inside (more symbols/connectivity = taller). "size" (1-2) = architectural importance.
- Positions: grid is ${MAP_GRID_W} wide (x) by ${MAP_GRID_H} deep (y). Spread modules out; put entry points near the top-left, core processing in the middle, outputs to the right. No two modules on the same cell.
- 2 to 4 flows tracing REAL paths along file dependencies (steps must follow plausible edges from the summary). kind is "flow" for the main path, "retry" for retry/fallback hops, "feedback" for loops back.
- "payload" names the actual data structure or artifact moving through the flow, using a real name from the summary when one exists.
- 4 stats, specific to this repo (module counts, flow counts, distinct file types, etc.). Keep values short.
- All prose must be concrete and grounded in the summary. Never say "the graph" or "the summary" — describe the system itself.`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // fall through to brace matching
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const owner = body.owner?.trim();
  const repo = body.repo?.trim();
  if (!owner || !repo) return json({ detail: "owner and repo are required" }, 400);

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return json({ detail: "OPENROUTER_API_KEY is not set" }, 500);

  let graph: AnalyzeResult | null | "building";
  try {
    graph = await loadGraph(req, owner, repo, body.graph_url);
  } catch (err) {
    return json({ detail: err instanceof Error ? err.message : "Graph load failed" }, 502);
  }
  if (graph === "building") {
    return json({ building: true, detail: "Graph is still being built" }, 202);
  }
  if (!graph) {
    return json(
      { detail: `Could not load or build a graph for ${owner}/${repo}. Check that the repository exists and is public.` },
      404,
    );
  }

  const summary = summarizeGraph(graph);
  const prompt = buildPrompt(owner, repo, summary);

  const models = Array.from(new Set([DEFAULT_MODEL, "z-ai/glm-5v-turbo"]));
  let lastError = "";

  for (const model of models) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            process.env.NEXT_PUBLIC_SITE_URL || "https://haywire-omega.vercel.app",
          "X-Title": "Haywire",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.4,
          max_tokens: 6000,
          response_format: { type: "json_object" },
          reasoning: { exclude: true },
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        lastError = data.error?.message || `OpenRouter ${res.status}`;
        continue;
      }

      const data = (await res.json()) as {
        model?: string;
        choices?: { message?: { content?: string } }[];
        usage?: { total_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      const raw = extractJson(content);
      if (!raw) {
        lastError = "Model returned unparseable JSON";
        continue;
      }

      const spec = normalizeSpec(raw, owner, repo, data.model || model);
      if (spec.modules.length < 3) {
        lastError = "Model returned too few modules";
        continue;
      }

      return json({ spec, total_tokens: data.usage?.total_tokens ?? 0 });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "OpenRouter request failed";
    }
  }

  return json({ detail: lastError || "Map generation failed" }, 502);
}
