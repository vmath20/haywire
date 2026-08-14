import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

async function deleteStorage(
  ctx: { storage: { delete: (id: Id<"_storage">) => Promise<void> } },
  id: Id<"_storage"> | undefined,
) {
  if (!id) return;
  try {
    await ctx.storage.delete(id);
  } catch {
    // ignore missing blobs
  }
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const save = mutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    label: v.optional(v.string()),
    nodeCount: v.optional(v.number()),
    edgeCount: v.optional(v.number()),
    communityCount: v.optional(v.number()),
    cached: v.optional(v.boolean()),
    graphStorageId: v.optional(v.id("_storage")),
    reportStorageId: v.optional(v.id("_storage")),
    thumbnailStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }

    const owner = args.owner.trim();
    const repo = args.repo.trim();
    const label = (args.label?.trim() || repo).trim();
    const now = Date.now();

    const existing = await ctx.db
      .query("savedGraphs")
      .withIndex("by_user_owner_repo", (q) =>
        q.eq("userId", userId).eq("owner", owner).eq("repo", repo),
      )
      .unique();

    if (existing) {
      if (args.graphStorageId && existing.graphStorageId && args.graphStorageId !== existing.graphStorageId) {
        await deleteStorage(ctx, existing.graphStorageId);
      }
      if (args.reportStorageId && existing.reportStorageId && args.reportStorageId !== existing.reportStorageId) {
        await deleteStorage(ctx, existing.reportStorageId);
      }
      if (
        args.thumbnailStorageId &&
        existing.thumbnailStorageId &&
        args.thumbnailStorageId !== existing.thumbnailStorageId
      ) {
        await deleteStorage(ctx, existing.thumbnailStorageId);
      }

      await ctx.db.patch(existing._id, {
        label,
        nodeCount: args.nodeCount ?? existing.nodeCount,
        edgeCount: args.edgeCount ?? existing.edgeCount,
        communityCount: args.communityCount ?? existing.communityCount,
        cached: args.cached ?? existing.cached,
        lastViewedAt: now,
        graphStorageId: args.graphStorageId ?? existing.graphStorageId,
        reportStorageId: args.reportStorageId ?? existing.reportStorageId,
        thumbnailStorageId: args.thumbnailStorageId ?? existing.thumbnailStorageId,
      });

      // Meter Graphify usage when we actually store/refresh graph artifacts.
      if (args.graphStorageId) {
        await ctx.db.insert("usageEvents", {
          userId,
          kind: "graph",
          at: now,
          owner,
          repo,
          label,
          nodeCount: args.nodeCount ?? existing.nodeCount,
          edgeCount: args.edgeCount ?? existing.edgeCount,
          cached: args.cached ?? existing.cached,
          costUsd: args.cached ? 0 : Math.max(0, (args.nodeCount ?? existing.nodeCount ?? 0) * 0.00001),
        });
      }
      return existing._id;
    }

    const id = await ctx.db.insert("savedGraphs", {
      userId,
      owner,
      repo,
      label,
      nodeCount: args.nodeCount,
      edgeCount: args.edgeCount,
      communityCount: args.communityCount,
      cached: args.cached,
      lastViewedAt: now,
      graphStorageId: args.graphStorageId,
      reportStorageId: args.reportStorageId,
      thumbnailStorageId: args.thumbnailStorageId,
    });

    if (args.graphStorageId) {
      await ctx.db.insert("usageEvents", {
        userId,
        kind: "graph",
        at: now,
        owner,
        repo,
        label,
        nodeCount: args.nodeCount,
        edgeCount: args.edgeCount,
        cached: args.cached,
        costUsd: args.cached ? 0 : Math.max(0, (args.nodeCount ?? 0) * 0.00001),
      });
    }
    return id;
  },
});

export const touch = mutation({
  args: { owner: v.string(), repo: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const existing = await ctx.db
      .query("savedGraphs")
      .withIndex("by_user_owner_repo", (q) =>
        q.eq("userId", userId).eq("owner", args.owner).eq("repo", args.repo),
      )
      .unique();
    if (!existing) return null;
    await ctx.db.patch(existing._id, { lastViewedAt: Date.now() });
    return existing._id;
  },
});

export const getByRepo = query({
  args: { owner: v.string(), repo: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const row = await ctx.db
      .query("savedGraphs")
      .withIndex("by_user_owner_repo", (q) =>
        q.eq("userId", userId).eq("owner", args.owner).eq("repo", args.repo),
      )
      .unique();
    if (!row) return null;

    return {
      ...row,
      graphUrl: row.graphStorageId ? await ctx.storage.getUrl(row.graphStorageId) : null,
      reportUrl: row.reportStorageId ? await ctx.storage.getUrl(row.reportStorageId) : null,
      thumbnailUrl: row.thumbnailStorageId
        ? await ctx.storage.getUrl(row.thumbnailStorageId)
        : null,
      hasArtifact: Boolean(row.graphStorageId),
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    const rows = await ctx.db
      .query("savedGraphs")
      .withIndex("by_user_lastViewed", (q) => q.eq("userId", userId))
      .order("desc")
      .take(500);

    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        thumbnailUrl: row.thumbnailStorageId
          ? await ctx.storage.getUrl(row.thumbnailStorageId)
          : null,
        graphUrl: row.graphStorageId ? await ctx.storage.getUrl(row.graphStorageId) : null,
        hasArtifact: Boolean(row.graphStorageId),
      })),
    );
  },
});

export const history = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    const rows = await ctx.db
      .query("savedGraphs")
      .withIndex("by_user_lastViewed", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);

    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        thumbnailUrl: row.thumbnailStorageId
          ? await ctx.storage.getUrl(row.thumbnailStorageId)
          : null,
        hasArtifact: Boolean(row.graphStorageId),
      })),
    );
  },
});

export const remove = mutation({
  args: { id: v.id("savedGraphs") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== userId) {
      throw new Error("Not found");
    }
    await deleteStorage(ctx, row.graphStorageId);
    await deleteStorage(ctx, row.reportStorageId);
    await deleteStorage(ctx, row.thumbnailStorageId);
    await ctx.db.delete(args.id);
  },
});
