import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("queryChats")
      .withIndex("by_user_lastMessage", (q) => q.eq("userId", userId))
      .order("desc")
      .take(500);
  },
});

export const get = query({
  args: { chatId: v.id("queryChats") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) return null;
    const messages = await ctx.db
      .query("queryMessages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    return { chat, messages };
  },
});

export const create = mutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    label: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const now = Date.now();
    return await ctx.db.insert("queryChats", {
      userId,
      title: args.title?.trim() || `Chat · ${args.repo}`,
      owner: args.owner,
      repo: args.repo,
      label: args.label?.trim() || args.repo,
      lastMessageAt: now,
    });
  },
});

export const appendMessage = mutation({
  args: {
    chatId: v.id("queryChats"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    graphContext: v.optional(v.string()),
    traversal: v.optional(
      v.object({
        mode: v.string(),
        depth: v.optional(v.number()),
        seeds: v.array(v.string()),
        visitOrder: v.array(
          v.object({
            id: v.string(),
            label: v.string(),
            depth: v.number(),
            seed: v.optional(v.boolean()),
            sourceFile: v.optional(v.string()),
          }),
        ),
        edges: v.array(
          v.object({
            from: v.string(),
            to: v.string(),
          }),
        ),
        nodeCount: v.optional(v.number()),
      }),
    ),
    model: v.optional(v.string()),
    elapsedMs: v.optional(v.number()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) throw new Error("Chat not found");

    const messageId = await ctx.db.insert("queryMessages", {
      chatId: args.chatId,
      role: args.role,
      content: args.content,
      graphContext: args.graphContext,
      traversal: args.traversal,
      model: args.model,
      elapsedMs: args.elapsedMs,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      totalTokens: args.totalTokens,
      costUsd: args.costUsd,
    });

    const patch: { lastMessageAt: number; title?: string } = {
      lastMessageAt: Date.now(),
    };
    if (args.title?.trim()) patch.title = args.title.trim().slice(0, 80);
    await ctx.db.patch(args.chatId, patch);
    return messageId;
  },
});

export const remove = mutation({
  args: { chatId: v.id("queryChats") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) throw new Error("Chat not found");
    const messages = await ctx.db
      .query("queryMessages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);
    await ctx.db.delete(args.chatId);
  },
});
