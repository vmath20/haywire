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
  process.env.OPENROUTER_MODEL?.trim() || "z-ai/glm-5v-turbo";
const FALLBACK_MODEL = "moonshotai/kimi-k2.6";
/** Per-model abort. Route maxDuration is 300s; keep the pair under that. */
const MODEL_TIMEOUT_MS: Record<string, number> = {
  "z-ai/glm-5v-turbo": 75_000,
  "moonshotai/kimi-k2.6": 90_000,
};
const DEFAULT_MODEL_TIMEOUT_MS = 90_000;

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

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 20_000,
): Promise<T | null> {
  const started = Date.now();
  const label = `${init?.method ?? "GET"} ${url.slice(0, 140)}`;
  try {
    console.info(`[map] fetch start ${label}`);
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      ...init,
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const snippet = await res.text().catch(() => "");
      console.warn(
        `[map] fetch ${res.status} ${ms}ms ${label}`,
        snippet.slice(0, 180),
      );
      return null;
    }
    const data = (await res.json()) as T;
    console.info(`[map] fetch ok ${ms}ms ${label}`);
    return data;
  } catch (err) {
    console.warn(
      `[map] fetch error ${Date.now() - started}ms ${label}`,
      err instanceof Error ? `${err.name}: ${err.message}` : err,
    );
    return null;
  }
}

/**
 * Load the repo graph: explicit URL → backend disk cache → kick off a fresh
 * analyze job. Never block this request waiting for a long clone — the client
 * already polls /api/map and a 202 tells it to come back.
 */
async function loadGraph(
  req: NextRequest,
  owner: string,
  repo: string,
  graphUrl?: string | null,
): Promise<AnalyzeResult | null | "building"> {
  if (graphUrl) {
    console.info("[map] loadGraph via graph_url", graphUrl.slice(0, 120));
    const fromUrl = await fetchJson<AnalyzeResult>(graphUrl, undefined, 45_000);
    if (fromUrl?.graph?.nodes?.length) {
      console.info("[map] loadGraph hit graph_url", fromUrl.graph.nodes.length, "nodes");
      return fromUrl;
    }
    console.warn("[map] loadGraph graph_url miss");
  }

  const base = backendBase(req);
  console.info("[map] loadGraph backend", base);
  const cached = await fetchJson<AnalyzeResult>(`${base}/graph/${owner}/${repo}`, undefined, 45_000);
  if (cached?.graph?.nodes?.length) {
    console.info("[map] loadGraph cache hit", cached.graph.nodes.length, "nodes");
    return cached;
  }

  console.info("[map] loadGraph starting analyze", `${owner}/${repo}`);
  const started = await fetchJson<{ job_id?: string }>(`${base}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `${owner}/${repo}`, force: false, code_only: true }),
  });
  if (!started?.job_id) {
    console.warn("[map] loadGraph analyze did not return a job_id");
    return null;
  }
  console.info("[map] loadGraph job", started.job_id);

  const job = await fetchJson<{ status?: string; error?: { message?: string } | null }>(
    `${base}/jobs/${started.job_id}`,
  );
  console.info("[map] loadGraph job status", job?.status);
  if (job?.status === "error") {
    throw new Error(job.error?.message || `Graph build failed for ${owner}/${repo}`);
  }
  if (job?.status === "done") {
    const fromJob = await fetchJson<AnalyzeResult>(
      `${base}/jobs/${started.job_id}/graph`,
      undefined,
      45_000,
    );
    if (fromJob?.graph?.nodes?.length) return fromJob;
    const fromCache = await fetchJson<AnalyzeResult>(
      `${base}/graph/${owner}/${repo}`,
      undefined,
      45_000,
    );
    if (fromCache?.graph?.nodes?.length) return fromCache;
  }

  console.info("[map] loadGraph still building");
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

  const large = nodes.length > 250 || files.size > 60;
  const fileCap = large ? 22 : 36;
  const symbolCap = large ? 4 : 6;
  const edgeCap = large ? 36 : 70;
  const charCap = large ? 8_000 : 12_000;

  const topFiles = [...files.entries()]
    .sort((a, b) => b[1].degree - a[1].degree)
    .slice(0, fileCap);

  const lines: string[] = [];
  lines.push(
    `GRAPH SUMMARY: ${nodes.length} symbols, ${links.length} edges, ${files.size} files.`,
    "",
    "FILES (path | symbols | connectivity | top symbols):",
  );
  for (const [path, info] of topFiles) {
    const top = info.symbols
      .sort((a, b) => b.degree - a.degree)
      .slice(0, symbolCap)
      .map((s) => s.label)
      .join(", ");
    lines.push(`- ${path} | ${info.nodes} symbols | degree ${info.degree} | ${top}`);
  }

  lines.push("", "FILE DEPENDENCIES (from -> to | edge count | relation):");
  const topEdges = [...fileEdges.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, edgeCap);
  for (const [key, e] of topEdges) {
    lines.push(`- ${key} | ${e.count} | ${e.relation}`);
  }

  let text = lines.join("\n");
  if (text.length > charCap) text = text.slice(0, charCap);
  return text;
}

function buildPrompt(owner: string, repo: string, summary: string): string {
  return `You are a systems cartographer. From the code-graph summary of ${owner}/${repo}, design an isometric system map: runtime architecture as buildings on a grid, flows as real control/data paths.

${summary}

Return ONLY JSON (no markdown) with this shape:
{
  "title": "Editorial title",
  "tagline": "One line: what a run of this system does",
  "what": "2-3 sentences: what this repo is and what happens when it runs",
  "how": "2-3 sentences: languages, architecture, where the hard problems live",
  "categories": [{ "id": "entry", "label": "Entry and control" }],
  "modules": [{
    "id": "CM", "name": "CLI", "category": "entry",
    "what": "What this module does at runtime",
    "how": "How it's built (key files, patterns)",
    "files": ["path/from/summary.py"],
    "stack": 3, "size": 1, "x": 2, "y": 1
  }],
  "flows": [{
    "id": "main", "name": "Main path",
    "tagline": "A → B → C",
    "what": "What moves through this flow",
    "payload": "A real type or artifact name",
    "sources": ["file.py"],
    "steps": [
      { "from": "CM", "to": "RL", "kind": "flow" }
    ]
  }],
  "stats": [{ "label": "Active modules", "value": "9" }]
}

Rules:
- 8–12 modules. Real subsystems grouped from the files. Ids: 1–3 unique uppercase letters. Huge repos: cluster; never exceed 12.
- 3 or 4 categories that fit THIS repo.
- Every module "files" entry must be a real path from the summary.
- stack 1–6 (more machinery = taller). size 1–2 (importance).
- Grid is ${MAP_GRID_W}×${MAP_GRID_H}. x/y are hints; do not stack two modules on one cell.
- 2–4 flows along plausible file dependencies. kind: "flow" | "retry" | "feedback".
- payload is a real data/artifact name from the summary when one exists.
- 4 short stats specific to this repo.
- Concrete prose about the system. Never mention "the graph" or "the summary".`;
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

export async function GET() {
  console.info("[map] GET health");
  return json({ ok: true, route: "map" });
}

export async function POST(req: NextRequest) {
  const rid = Math.random().toString(36).slice(2, 8);
  console.info(`[map ${rid}] POST begin`);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    console.warn(`[map ${rid}] invalid JSON body`);
    return json({ detail: "Invalid JSON" }, 400);
  }

  const owner = body.owner?.trim();
  const repo = body.repo?.trim();
  if (!owner || !repo) {
    console.warn(`[map ${rid}] missing owner/repo`);
    return json({ detail: "owner and repo are required" }, 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        console.info(
          `[map ${rid}] event`,
          obj.type,
          obj.status ?? obj.detail ?? obj.message ?? "",
        );
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* closed */
        }
      }, 4000);

      try {
        send({
          type: "log",
          message: `Request ${rid} for ${owner}/${repo}`,
        });
        send({
          type: "status",
          status: "Loading code graph",
          note: body.graph_url ? "Using saved graph" : "Looking up graph cache",
        });

        const apiKey = process.env.OPENROUTER_API_KEY?.trim();
        if (!apiKey) {
          send({ type: "error", detail: "OPENROUTER_API_KEY is not set" });
          return;
        }

        let graph: AnalyzeResult | null | "building";
        try {
          graph = await loadGraph(req, owner, repo, body.graph_url);
        } catch (err) {
          send({
            type: "error",
            detail: err instanceof Error ? err.message : "Graph load failed",
          });
          return;
        }

        if (graph === "building") {
          send({ type: "building", detail: "Graph is still being built" });
          return;
        }
        if (!graph) {
          send({
            type: "error",
            detail: `Could not load or build a graph for ${owner}/${repo}. Check that the repository exists and is public.`,
          });
          return;
        }

        send({
          type: "log",
          message: `Graph loaded: ${graph.graph.nodes.length} nodes, ${graph.graph.links.length} edges`,
        });
        send({
          type: "status",
          status: "Drafting system map",
          note: "Asking the model to lay out modules and flows",
        });

        const summary = summarizeGraph(graph);
        const prompt = buildPrompt(owner, repo, summary);
        const models = Array.from(
          new Set(["z-ai/glm-5v-turbo", DEFAULT_MODEL, FALLBACK_MODEL]),
        );
        send({
          type: "log",
          message: `Prompt ${prompt.length} chars; models ${models.join(" → ")}`,
        });

        let lastError = "";
        for (const [index, model] of models.entries()) {
          const t0 = Date.now();
          const timeoutMs = MODEL_TIMEOUT_MS[model] ?? DEFAULT_MODEL_TIMEOUT_MS;
          if (index > 0) {
            send({
              type: "status",
              status: "Trying a second model",
              note: lastError || "First model did not finish in time",
            });
          }
          send({ type: "log", message: `Calling ${model} (${Math.round(timeoutMs / 1000)}s budget)` });
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
                max_tokens: 4000,
                response_format: { type: "json_object" },
                reasoning: { exclude: true },
                usage: { include: true },
              }),
              signal: AbortSignal.timeout(timeoutMs),
            });
            const ms = Date.now() - t0;
            if (!res.ok) {
              const data = (await res.json().catch(() => ({}))) as {
                error?: { message?: string };
              };
              lastError = data.error?.message || `OpenRouter ${res.status}`;
              send({ type: "log", message: `${model} failed ${res.status} in ${ms}ms: ${lastError}` });
              continue;
            }

            const data = (await res.json()) as {
              model?: string;
              choices?: { message?: { content?: string } }[];
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
                cost?: number;
              };
            };
            const content = data.choices?.[0]?.message?.content ?? "";
            const promptTokens = data.usage?.prompt_tokens ?? 0;
            const completionTokens = data.usage?.completion_tokens ?? 0;
            const totalTokens =
              data.usage?.total_tokens ?? promptTokens + completionTokens;
            const costUsd = typeof data.usage?.cost === "number" ? data.usage.cost : 0;
            send({
              type: "log",
              message: `${model} ok in ${ms}ms, ${content.length} chars, ${totalTokens} tokens, $${costUsd.toFixed(4)}`,
            });
            const raw = extractJson(content);
            if (!raw) {
              lastError = "Model returned unparseable JSON";
              send({ type: "log", message: lastError });
              continue;
            }

            const spec = normalizeSpec(raw, owner, repo, data.model || model, {
              relayout: true,
            });
            if (spec.modules.length < 3) {
              lastError =
                spec.modules.length === 0
                  ? "This repository is too large to map into a readable city. Try a smaller or more focused repo."
                  : "This repository didn't produce a readable map (too few subsystems fit the grid). Try again.";
              send({ type: "log", message: `${lastError} (${spec.modules.length})` });
              continue;
            }

            send({
              type: "done",
              spec,
              model: data.model || model,
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: totalTokens,
              cost_usd: costUsd,
            });
            return;
          } catch (err) {
            const name = err instanceof Error ? err.name : "";
            const msg = err instanceof Error ? err.message : "OpenRouter request failed";
            lastError =
              name === "TimeoutError" || /timeout|aborted/i.test(msg)
                ? "Model timed out"
                : msg;
            send({ type: "log", message: `${model} threw: ${lastError}` });
          }
        }

        send({ type: "error", detail: lastError || "Map generation failed" });
      } catch (err) {
        const detail = err instanceof Error ? err.message : "Map generation failed";
        console.error(`[map ${rid}] crash`, err);
        try {
          send({ type: "error", detail });
        } catch {
          /* closed */
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* closed */
        }
        console.info(`[map ${rid}] stream closed`);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
