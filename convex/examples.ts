import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const EXAMPLE_CATALOG = [
  { owner: "openclaw", repo: "openclaw", label: "OpenClaw" },
  { owner: "mermaid-js", repo: "mermaid", label: "Mermaid" },
  { owner: "karpathy", repo: "nanochat", label: "nanochat" },
  { owner: "agent0ai", repo: "agent-zero", label: "Agent Zero" },
  { owner: "langchain-ai", repo: "langchain", label: "LangChain" },
] as const;

type AnalyzeResult = {
  owner: string;
  repo: string;
  cached?: boolean;
  graph: { nodes: unknown[]; links: unknown[] };
  summary: {
    node_count: number;
    edge_count: number;
    community_count: number;
  };
  report?: string | null;
  meta?: Record<string, unknown>;
};

function apiBase() {
  return (
    process.env.HAYWIRE_API_URL?.replace(/\/$/, "") ||
    "https://haywire-omega.vercel.app/api/backend"
  );
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function buildViaApi(owner: string, repo: string): Promise<AnalyzeResult> {
  const base = apiBase();

  const cached = await fetch(`${base}/graph/${owner}/${repo}`);
  if (cached.ok) {
    return (await cached.json()) as AnalyzeResult;
  }

  const start = await fetch(`${base}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `${owner}/${repo}`, force: false, code_only: true }),
  });
  if (!start.ok) {
    const err = await start.text();
    throw new Error(`analyze failed for ${owner}/${repo}: ${err.slice(0, 500)}`);
  }
  const { job_id } = (await start.json()) as { job_id: string };

  let sawDone = false;
  // Up to ~25 minutes for large repos (multi-instance may return pending briefly)
  for (let i = 0; i < 750; i++) {
    await sleep(2000);
    const res = await fetch(`${base}/jobs/${job_id}`);
    if (!res.ok) continue;
    const job = await res.json();
    if (job.status === "done") {
      sawDone = true;
      // Prefer job-local graph (same replica), then shared /graph cache.
      for (let attempt = 0; attempt < 30; attempt++) {
        const fromJob = await fetch(`${base}/jobs/${job_id}/graph`);
        if (fromJob.ok) {
          return (await fromJob.json()) as AnalyzeResult;
        }
        const graphRes = await fetch(`${base}/graph/${owner}/${repo}`);
        if (graphRes.ok) {
          return (await graphRes.json()) as AnalyzeResult;
        }
        await sleep(1000);
      }
      throw new Error(`graph fetch failed for ${owner}/${repo} after job done`);
    }
    if (job.status === "error") {
      throw new Error(job.error?.message || `build error for ${owner}/${repo}`);
    }
  }
  throw new Error(
    sawDone
      ? `could not retrieve graph for ${owner}/${repo}`
      : `timeout building ${owner}/${repo}`,
  );
}

function svgThumbnail(result: AnalyzeResult): Blob {
  const nodes = (result.graph.nodes as { id: string; community?: number }[]).slice(0, 120);
  const idSet = new Set(nodes.map((n) => n.id));
  const links = (result.graph.links as { source: string; target: string }[])
    .filter((e) => idSet.has(e.source) && idSet.has(e.target))
    .slice(0, 220);

  const w = 640;
  const h = 360;
  const cx = w / 2;
  const cy = h / 2;
  const colors = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1"];
  const byC = new Map<number, typeof nodes>();
  for (const n of nodes) {
    const c = n.community ?? 0;
    const list = byC.get(c) ?? [];
    list.push(n);
    byC.set(c, list);
  }
  const cids = [...byC.keys()];
  const pos = new Map<string, { x: number; y: number }>();
  cids.forEach((cid, i) => {
    const members = byC.get(cid)!;
    const angle = (i / Math.max(cids.length, 1)) * Math.PI * 2;
    const gx = cx + Math.cos(angle) * 110;
    const gy = cy + Math.sin(angle) * 90;
    const r = 16 + Math.min(50, members.length * 2);
    members.forEach((n, j) => {
      const a = (j / Math.max(members.length, 1)) * Math.PI * 2;
      pos.set(n.id, { x: gx + Math.cos(a) * r, y: gy + Math.sin(a) * r });
    });
  });

  const edgePaths = links
    .map((e) => {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) return "";
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="rgba(11,13,16,0.18)" stroke-width="1"/>`;
    })
    .join("");

  const nodeCircles = nodes
    .map((n) => {
      const p = pos.get(n.id);
      if (!p) return "";
      const color = colors[(n.community ?? 0) % colors.length];
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" fill="${color}" stroke="rgba(11,13,16,0.35)" stroke-width="0.8"/>`;
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f3f4f6"/>${edgePaths}${nodeCircles}</svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("exampleGraphs").collect();
    const byKey = new Map(rows.map((r) => [`${r.owner}/${r.repo}`, r]));
    return await Promise.all(
      EXAMPLE_CATALOG.map(async (ex) => {
        const row = byKey.get(`${ex.owner}/${ex.repo}`);
        return {
          owner: ex.owner,
          repo: ex.repo,
          label: ex.label,
          nodeCount: row?.nodeCount,
          edgeCount: row?.edgeCount,
          communityCount: row?.communityCount,
          ready: Boolean(row),
          thumbnailUrl: row?.thumbnailStorageId
            ? await ctx.storage.getUrl(row.thumbnailStorageId)
            : null,
          builtAt: row?.builtAt,
        };
      }),
    );
  },
});

export const getByRepo = query({
  args: { owner: v.string(), repo: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("exampleGraphs")
      .withIndex("by_owner_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .unique();
    if (!row) return null;
    const displayGraphStorageId = (row as { displayGraphStorageId?: Id<"_storage"> })
      .displayGraphStorageId;
    return {
      ...row,
      graphUrl: await ctx.storage.getUrl(row.graphStorageId),
      displayGraphUrl: displayGraphStorageId
        ? await ctx.storage.getUrl(displayGraphStorageId)
        : null,
      reportUrl: row.reportStorageId ? await ctx.storage.getUrl(row.reportStorageId) : null,
      thumbnailUrl: row.thumbnailStorageId
        ? await ctx.storage.getUrl(row.thumbnailStorageId)
        : null,
      hasArtifact: true,
      hasDisplaySubset: Boolean(displayGraphStorageId),
    };
  },
});

export const upsert = internalMutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    label: v.string(),
    nodeCount: v.optional(v.number()),
    edgeCount: v.optional(v.number()),
    communityCount: v.optional(v.number()),
    graphStorageId: v.id("_storage"),
    displayGraphStorageId: v.optional(v.id("_storage")),
    reportStorageId: v.optional(v.id("_storage")),
    thumbnailStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("exampleGraphs")
      .withIndex("by_owner_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .unique();

    const payload = {
      owner: args.owner,
      repo: args.repo,
      label: args.label,
      nodeCount: args.nodeCount,
      edgeCount: args.edgeCount,
      communityCount: args.communityCount,
      graphStorageId: args.graphStorageId,
      displayGraphStorageId: args.displayGraphStorageId,
      reportStorageId: args.reportStorageId,
      thumbnailStorageId: args.thumbnailStorageId,
      builtAt: Date.now(),
    };

    if (existing) {
      const oldRow = existing as typeof existing & {
        displayGraphStorageId?: Id<"_storage">;
      };
      const old = [
        existing.graphStorageId,
        oldRow.displayGraphStorageId,
        existing.reportStorageId,
        existing.thumbnailStorageId,
      ];
      await ctx.db.patch(existing._id, payload);
      for (const id of old) {
        if (
          id &&
          id !== args.graphStorageId &&
          id !== args.displayGraphStorageId &&
          id !== args.reportStorageId &&
          id !== args.thumbnailStorageId
        ) {
          try {
            await ctx.storage.delete(id);
          } catch {
            // ignore
          }
        }
      }
      return existing._id;
    }
    return await ctx.db.insert("exampleGraphs", payload);
  },
});

/** Admin/CLI helper for local seeding scripts (`npx convex run`). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Finalize a locally built example after uploading blobs via generateUploadUrl. */
export const seedFinalize = mutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    label: v.string(),
    nodeCount: v.optional(v.number()),
    edgeCount: v.optional(v.number()),
    communityCount: v.optional(v.number()),
    graphStorageId: v.id("_storage"),
    displayGraphStorageId: v.optional(v.id("_storage")),
    reportStorageId: v.optional(v.id("_storage")),
    thumbnailStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args): Promise<Id<"exampleGraphs">> => {
    const existing = await ctx.db
      .query("exampleGraphs")
      .withIndex("by_owner_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .unique();

    const payload = {
      owner: args.owner,
      repo: args.repo,
      label: args.label,
      nodeCount: args.nodeCount,
      edgeCount: args.edgeCount,
      communityCount: args.communityCount,
      graphStorageId: args.graphStorageId,
      displayGraphStorageId: args.displayGraphStorageId,
      reportStorageId: args.reportStorageId,
      thumbnailStorageId: args.thumbnailStorageId,
      builtAt: Date.now(),
    };

    if (existing) {
      const oldRow = existing as typeof existing & {
        displayGraphStorageId?: Id<"_storage">;
      };
      const old = [
        existing.graphStorageId,
        oldRow.displayGraphStorageId,
        existing.reportStorageId,
        existing.thumbnailStorageId,
      ];
      await ctx.db.patch(existing._id, payload);
      for (const id of old) {
        if (
          id &&
          id !== args.graphStorageId &&
          id !== args.displayGraphStorageId &&
          id !== args.reportStorageId &&
          id !== args.thumbnailStorageId
        ) {
          try {
            await ctx.storage.delete(id);
          } catch {
            // ignore
          }
        }
      }
      return existing._id;
    }
    return await ctx.db.insert("exampleGraphs", payload);
  },
});

/** Attach a prebuilt display subset blob to an existing example. */
export const attachDisplaySubset = mutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    displayGraphStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("exampleGraphs")
      .withIndex("by_owner_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .unique();
    if (!existing) throw new Error(`example not found: ${args.owner}/${args.repo}`);
    const oldRow = existing as typeof existing & {
      displayGraphStorageId?: Id<"_storage">;
    };
    const prev = oldRow.displayGraphStorageId;
    await ctx.db.patch(existing._id, {
      displayGraphStorageId: args.displayGraphStorageId,
    });
    if (prev && prev !== args.displayGraphStorageId) {
      try {
        await ctx.storage.delete(prev);
      } catch {
        // ignore
      }
    }
    return existing._id;
  },
});

type SeedResult = {
  owner: string;
  repo: string;
  nodeCount: number;
  edgeCount: number;
};

async function seedRepo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { storage: { store: (blob: Blob) => Promise<Id<"_storage">> }; runMutation: any },
  args: { owner: string; repo: string; label: string },
): Promise<SeedResult> {
  const result = await buildViaApi(args.owner, args.repo);
  const graphBlob = new Blob([JSON.stringify(result)], { type: "application/json" });
  const graphStorageId = await ctx.storage.store(graphBlob);

  let reportStorageId: Id<"_storage"> | undefined;
  if (result.report) {
    reportStorageId = await ctx.storage.store(
      new Blob([result.report], { type: "text/markdown;charset=utf-8" }),
    );
  }

  const thumbnailStorageId = await ctx.storage.store(svgThumbnail(result));

  await ctx.runMutation(internal.examples.upsert, {
    owner: args.owner,
    repo: args.repo,
    label: args.label,
    nodeCount: result.summary.node_count,
    edgeCount: result.summary.edge_count,
    communityCount: result.summary.community_count,
    graphStorageId,
    reportStorageId,
    thumbnailStorageId,
  });

  return {
    owner: args.owner,
    repo: args.repo,
    nodeCount: result.summary.node_count,
    edgeCount: result.summary.edge_count,
  };
}

export const seedOne = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    label: v.string(),
  },
  handler: async (ctx, args): Promise<SeedResult> => seedRepo(ctx, args),
});

export const seedOneInternal = internalAction({
  args: {
    owner: v.string(),
    repo: v.string(),
    label: v.string(),
  },
  handler: async (ctx, args): Promise<SeedResult> => seedRepo(ctx, args),
});

export const seedAll = action({
  args: {},
  handler: async (ctx) => {
    const results: Array<{
      owner: string;
      repo: string;
      label: string;
      ok: boolean;
      nodeCount?: number;
      edgeCount?: number;
      error?: string;
    }> = [];
    for (const ex of EXAMPLE_CATALOG) {
      try {
        const r: SeedResult = await ctx.runAction(
          internal.examples.seedOneInternal,
          ex,
        );
        results.push({
          owner: ex.owner,
          repo: ex.repo,
          label: ex.label,
          ok: true,
          nodeCount: r.nodeCount,
          edgeCount: r.edgeCount,
        });
      } catch (e) {
        results.push({
          owner: ex.owner,
          repo: ex.repo,
          label: ex.label,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return results;
  },
});
