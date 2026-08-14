#!/usr/bin/env node
/**
 * Haywire MCP server — exposes Haywire's code knowledge graphs to MCP
 * clients (Cursor, Claude Code, …) over stdio.
 *
 * Tools: find_symbol, who_calls, trace_path, explain_module.
 * Every tool takes `repo` ("owner/repo" or a GitHub URL). Graphs for repos
 * Haywire has already analyzed load instantly; unseen repos trigger a build
 * on first use.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  BuildPendingError,
  type GraphLink,
  type GraphNode,
  type IndexedGraph,
  degreeOf,
  lineNumber,
  loadGraph,
  nodeLocation,
  nodeSummary,
  searchSymbols,
  resolveSymbol,
} from "./graph.js";

const server = new McpServer({ name: "haywire", version: "0.1.0" });

const repoArg = z
  .string()
  .describe('GitHub repository, e.g. "karpathy/nanochat" or a full GitHub URL');

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

async function withGraph<T>(
  repo: string,
  fn: (g: IndexedGraph) => T,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  try {
    const g = await loadGraph(repo);
    return ok(fn(g));
  } catch (e) {
    if (e instanceof BuildPendingError) return fail(e.message);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function notFoundMessage(g: IndexedGraph, query: string): string {
  const near = searchSymbols(g, query.slice(0, Math.max(3, Math.floor(query.length / 2))))
    .slice(0, 5)
    .map((m) => m.node.label);
  return (
    `No symbol matching "${query}" in the ${g.owner}/${g.repo} graph.` +
    (near.length ? ` Closest labels: ${near.join(", ")}.` : "") +
    ` Try find_symbol with a shorter query.`
  );
}

/* ─── find_symbol ─────────────────────────────────────────────── */

server.registerTool(
  "find_symbol",
  {
    title: "Find symbol",
    description:
      "Search a repository's code knowledge graph for functions, classes, and modules by " +
      "(fuzzy) name. Returns each match's source location, kind, community (subsystem), and " +
      "how connected it is. Use this first to get exact symbol names for the other tools.",
    inputSchema: {
      repo: repoArg,
      query: z.string().describe('Symbol name or fragment, e.g. "GPT" or "checkpoint"'),
      limit: z.number().int().min(1).max(50).optional().describe("Max matches (default 10)"),
    },
  },
  async ({ repo, query, limit }) =>
    withGraph(repo, (g) => {
      const matches = searchSymbols(g, query);
      return {
        repo: `${g.owner}/${g.repo}`,
        query,
        total_matches: matches.length,
        graph_size: { nodes: g.nodeCount, edges: g.edgeCount },
        matches: matches.slice(0, limit ?? 10).map((m) => nodeSummary(g, m.node)),
      };
    }),
);

/* ─── who_calls ───────────────────────────────────────────────── */

server.registerTool(
  "who_calls",
  {
    title: "Who calls",
    description:
      "List everything that calls / depends on a symbol (reverse edges in the code graph). " +
      "Each caller includes its own definition site plus the call-site file:line when known. " +
      "Set depth > 1 to include transitive callers.",
    inputSchema: {
      repo: repoArg,
      symbol: z.string().describe("Symbol to find callers of (as returned by find_symbol)"),
      depth: z
        .number()
        .int()
        .min(1)
        .max(3)
        .optional()
        .describe("1 = direct callers only (default), up to 3 for transitive callers"),
      limit: z.number().int().min(1).max(100).optional().describe("Max callers (default 25)"),
    },
  },
  async ({ repo, symbol, depth, limit }) =>
    withGraph(repo, (g) => {
      const { best, alternates } = resolveSymbol(g, symbol);
      if (!best) throw new Error(notFoundMessage(g, symbol));

      const maxDepth = depth ?? 1;
      const cap = limit ?? 25;
      type Row = {
        caller: string;
        defined_at: string;
        relation: string;
        call_site: string | null;
        depth: number;
        calls_into: string;
      };
      const rows: Row[] = [];
      const seen = new Set<string>([best.id]);
      let frontier = [best.id];

      for (let d = 1; d <= maxDepth && frontier.length && rows.length < cap * 2; d++) {
        const next: string[] = [];
        for (const id of frontier) {
          const target = g.byId.get(id);
          for (const link of g.inc.get(id) ?? []) {
            const caller = g.byId.get(link.source);
            if (!caller || seen.has(caller.id)) continue;
            seen.add(caller.id);
            next.push(caller.id);
            const callLine = lineNumber(link.source_location);
            rows.push({
              caller: caller.label,
              defined_at: nodeLocation(caller),
              relation: link.relation ?? "depends_on",
              call_site: link.source_file
                ? `${link.source_file}${callLine ? `:${callLine}` : ""}`
                : null,
              depth: d,
              calls_into: target?.label ?? symbol,
            });
          }
        }
        frontier = next;
      }

      const direct = rows.filter((r) => r.depth === 1).length;
      return {
        repo: `${g.owner}/${g.repo}`,
        symbol: best.label,
        defined_at: nodeLocation(best),
        direct_callers: direct,
        transitive_callers_included: maxDepth > 1,
        callers: rows.slice(0, cap),
        truncated: rows.length > cap,
        ...(alternates.length
          ? { also_matched: alternates.map((n) => `${n.label} (${nodeLocation(n)})`) }
          : {}),
      };
    }),
);

/* ─── trace_path ──────────────────────────────────────────────── */

server.registerTool(
  "trace_path",
  {
    title: "Trace path",
    description:
      "Find the shortest dependency path between two symbols in the code graph — how does A " +
      "reach B? Tries directed edges (call/dependency direction) first, then falls back to an " +
      "undirected path with per-hop direction markers.",
    inputSchema: {
      repo: repoArg,
      from: z.string().describe("Start symbol"),
      to: z.string().describe("End symbol"),
    },
  },
  async ({ repo, from, to }) =>
    withGraph(repo, (g) => {
      const a = resolveSymbol(g, from);
      const b = resolveSymbol(g, to);
      if (!a.best) throw new Error(notFoundMessage(g, from));
      if (!b.best) throw new Error(notFoundMessage(g, to));
      const src = a.best;
      const dst = b.best;

      type Hop = { from: string; to: string; relation: string; direction: "forward" | "reverse" };

      const bfs = (undirected: boolean): Hop[] | null => {
        if (src.id === dst.id) return [];
        const prev = new Map<string, { id: string; link: GraphLink; forward: boolean }>();
        const queue = [src.id];
        const visited = new Set([src.id]);
        while (queue.length) {
          const id = queue.shift()!;
          const neighbors: { next: string; link: GraphLink; forward: boolean }[] = [];
          for (const l of g.out.get(id) ?? []) {
            neighbors.push({ next: l.target, link: l, forward: true });
          }
          if (undirected) {
            for (const l of g.inc.get(id) ?? []) {
              neighbors.push({ next: l.source, link: l, forward: false });
            }
          }
          for (const { next, link, forward } of neighbors) {
            if (visited.has(next)) continue;
            visited.add(next);
            prev.set(next, { id, link, forward });
            if (next === dst.id) {
              const hops: Hop[] = [];
              let cur = dst.id;
              while (cur !== src.id) {
                const p = prev.get(cur)!;
                const fromNode = g.byId.get(p.forward ? p.id : cur);
                const toNode = g.byId.get(p.forward ? cur : p.id);
                hops.unshift({
                  from: fromNode?.label ?? "?",
                  to: toNode?.label ?? "?",
                  relation: p.link.relation ?? "depends_on",
                  direction: p.forward ? "forward" : "reverse",
                });
                cur = p.id;
              }
              return hops;
            }
            queue.push(next);
          }
        }
        return null;
      };

      const directed = bfs(false);
      const hops = directed ?? bfs(true);
      const chain = (hs: Hop[]) =>
        hs.length
          ? [
              hs[0]!.direction === "forward" ? hs[0]!.from : hs[0]!.to,
              ...hs.map(
                (h) =>
                  `${h.direction === "forward" ? "→" : "←"}[${h.relation}] ${
                    h.direction === "forward" ? h.to : h.from
                  }`,
              ),
            ].join(" ")
          : "(same symbol)";

      return {
        repo: `${g.owner}/${g.repo}`,
        from: { symbol: src.label, defined_at: nodeLocation(src) },
        to: { symbol: dst.label, defined_at: nodeLocation(dst) },
        found: hops !== null,
        directed: directed !== null,
        hop_count: hops?.length ?? null,
        path: hops ?? [],
        readable: hops ? chain(hops) : `No path connects ${src.label} and ${dst.label} in the graph.`,
        note:
          directed === null && hops !== null
            ? "No directed path exists; showing an undirected connection (reverse hops marked ←)."
            : undefined,
      };
    }),
);

/* ─── explain_module ──────────────────────────────────────────── */

server.registerTool(
  "explain_module",
  {
    title: "Explain module",
    description:
      "Structural summary of a module/file: the symbols it defines, its key (most connected) " +
      "symbols, which files it depends on, which files depend on it, and the subsystem " +
      "communities it belongs to. Accepts a file path, filename, or directory fragment.",
    inputSchema: {
      repo: repoArg,
      module: z
        .string()
        .describe('File path or fragment, e.g. "nanochat/gpt.py", "gpt.py", or "tasks/"'),
    },
  },
  async ({ repo, module }) =>
    withGraph(repo, (g) => {
      const ml = module.trim().toLowerCase().replace(/^\/+/, "");
      const files = new Map<string, GraphNode[]>();
      for (const n of g.nodes) {
        if (!n.source_file) continue;
        (files.get(n.source_file) ?? files.set(n.source_file, []).get(n.source_file)!).push(n);
      }

      const scoreFile = (f: string): number => {
        const fl = f.toLowerCase();
        if (fl === ml) return 100;
        if (fl.endsWith(`/${ml}`)) return 90;
        if (fl.startsWith(ml)) return 70;
        if (fl.includes(`/${ml}`) || fl.includes(ml)) return 50;
        return 0;
      };

      const scored = [...files.keys()]
        .map((f) => ({ f, s: scoreFile(f) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.f.length - b.f.length);
      if (!scored.length) {
        const sample = [...files.keys()].slice(0, 10);
        throw new Error(
          `No file in ${g.owner}/${g.repo} matches "${module}". Example files in this graph: ${sample.join(", ")}`,
        );
      }

      // Exact/suffix hit → that file. Otherwise treat as a directory/fragment
      // and include everything that matched.
      const top = scored[0]!;
      const matchedFiles =
        top.s >= 90 ? [top.f] : scored.slice(0, 12).map((x) => x.f);
      const matchedSet = new Set(matchedFiles);

      const members = matchedFiles.flatMap((f) => files.get(f) ?? []);
      const memberIds = new Set(members.map((n) => n.id));

      let internalEdges = 0;
      const outByFile = new Map<string, { count: number; examples: Set<string> }>();
      const inByFile = new Map<string, { count: number; examples: Set<string> }>();

      for (const n of members) {
        for (const l of g.out.get(n.id) ?? []) {
          const target = g.byId.get(l.target);
          if (!target) continue;
          if (memberIds.has(target.id)) {
            internalEdges++;
            continue;
          }
          const f = target.source_file ?? "(unknown)";
          if (matchedSet.has(f)) continue;
          const entry = outByFile.get(f) ?? { count: 0, examples: new Set<string>() };
          entry.count++;
          if (entry.examples.size < 3) entry.examples.add(`${n.label} → ${target.label}`);
          outByFile.set(f, entry);
        }
        for (const l of g.inc.get(n.id) ?? []) {
          const source = g.byId.get(l.source);
          if (!source || memberIds.has(source.id)) continue;
          const f = source.source_file ?? "(unknown)";
          if (matchedSet.has(f)) continue;
          const entry = inByFile.get(f) ?? { count: 0, examples: new Set<string>() };
          entry.count++;
          if (entry.examples.size < 3) entry.examples.add(`${source.label} → ${n.label}`);
          inByFile.set(f, entry);
        }
      }

      const rankFiles = (m: Map<string, { count: number; examples: Set<string> }>) =>
        [...m.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 8)
          .map(([f, v]) => ({ file: f, edges: v.count, examples: [...v.examples] }));

      const keySymbols = members
        .map((n) => {
          const d = degreeOf(g, n.id);
          return { n, total: d.in + d.out };
        })
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map(({ n }) => nodeSummary(g, n));

      const communities = [
        ...new Set(members.map((n) => n.community_name).filter(Boolean)),
      ] as string[];

      return {
        repo: `${g.owner}/${g.repo}`,
        module,
        matched_files: matchedFiles,
        symbol_count: members.length,
        internal_edges: internalEdges,
        key_symbols: keySymbols,
        depends_on: rankFiles(outByFile),
        depended_on_by: rankFiles(inByFile),
        communities,
      };
    }),
);

/* ─── start ───────────────────────────────────────────────────── */

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `haywire-mcp ready (api: ${process.env.HAYWIRE_API_URL || "default"}, convex: ${
    process.env.HAYWIRE_CONVEX_URL || "default"
  })`,
);
