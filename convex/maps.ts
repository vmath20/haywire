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
    if (userId === null) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

/** List the signed-in user's system maps, most recent first. */
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("systemMaps"),
      _creationTime: v.number(),
      owner: v.string(),
      repo: v.string(),
      label: v.string(),
      model: v.optional(v.string()),
      lastViewedAt: v.number(),
      spec: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("systemMaps")
      .withIndex("by_user_lastViewed", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    return rows.map((r) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      owner: r.owner,
      repo: r.repo,
      label: r.label,
      model: r.model,
      lastViewedAt: r.lastViewedAt,
      spec: r.spec,
    }));
  },
});

/** Fetch the signed-in user's map for a repo (spec JSON included). */
export const getByRepo = query({
  args: { owner: v.string(), repo: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("systemMaps"),
      owner: v.string(),
      repo: v.string(),
      label: v.string(),
      spec: v.string(),
      model: v.optional(v.string()),
      lastViewedAt: v.number(),
      hasThumbnail: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const row = await ctx.db
      .query("systemMaps")
      .withIndex("by_user_owner_repo", (q) =>
        q.eq("userId", userId).eq("owner", args.owner).eq("repo", args.repo),
      )
      .unique();
    if (!row) return null;
    return {
      _id: row._id,
      owner: row.owner,
      repo: row.repo,
      label: row.label,
      spec: row.spec,
      model: row.model,
      lastViewedAt: row.lastViewedAt,
      hasThumbnail: Boolean(row.thumbnailStorageId),
    };
  },
});

/** Upsert the user's map for a repo. */
export const save = mutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    label: v.optional(v.string()),
    spec: v.string(),
    model: v.optional(v.string()),
    thumbnailStorageId: v.optional(v.id("_storage")),
  },
  returns: v.id("systemMaps"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const owner = args.owner.trim();
    const repo = args.repo.trim();
    const label = (args.label?.trim() || repo).trim();
    const now = Date.now();

    const existing = await ctx.db
      .query("systemMaps")
      .withIndex("by_user_owner_repo", (q) =>
        q.eq("userId", userId).eq("owner", owner).eq("repo", repo),
      )
      .unique();

    if (existing) {
      if (
        args.thumbnailStorageId &&
        existing.thumbnailStorageId &&
        args.thumbnailStorageId !== existing.thumbnailStorageId
      ) {
        await deleteStorage(ctx, existing.thumbnailStorageId);
      }
      await ctx.db.patch(existing._id, {
        label,
        spec: args.spec,
        model: args.model,
        lastViewedAt: now,
        ...(args.thumbnailStorageId
          ? { thumbnailStorageId: args.thumbnailStorageId }
          : {}),
      });
      return existing._id;
    }

    return await ctx.db.insert("systemMaps", {
      userId,
      owner,
      repo,
      label,
      spec: args.spec,
      model: args.model,
      lastViewedAt: now,
      thumbnailStorageId: args.thumbnailStorageId,
    });
  },
});

/** Bump lastViewedAt when a map is opened. */
export const touch = mutation({
  args: { owner: v.string(), repo: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const row = await ctx.db
      .query("systemMaps")
      .withIndex("by_user_owner_repo", (q) =>
        q.eq("userId", userId).eq("owner", args.owner).eq("repo", args.repo),
      )
      .unique();
    if (row) await ctx.db.patch(row._id, { lastViewedAt: Date.now() });
    return null;
  },
});

/** Delete one of the user's maps. */
export const remove = mutation({
  args: { id: v.id("systemMaps") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    if (row.userId !== userId) throw new Error("Unauthorized");
    await deleteStorage(ctx, row.thumbnailStorageId);
    await ctx.db.delete(args.id);
    return null;
  },
});
