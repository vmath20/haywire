import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  savedGraphs: defineTable({
    userId: v.id("users"),
    owner: v.string(),
    repo: v.string(),
    label: v.string(),
    nodeCount: v.optional(v.number()),
    edgeCount: v.optional(v.number()),
    communityCount: v.optional(v.number()),
    cached: v.optional(v.boolean()),
    lastViewedAt: v.number(),
    /** Full AnalyzeResult JSON (graph + summary + report + meta). */
    graphStorageId: v.optional(v.id("_storage")),
    /** Optional markdown report blob (also embedded in AnalyzeResult). */
    reportStorageId: v.optional(v.id("_storage")),
    /** JPEG/PNG preview of the graph. */
    thumbnailStorageId: v.optional(v.id("_storage")),
  })
    .index("by_user_lastViewed", ["userId", "lastViewedAt"])
    .index("by_user_owner_repo", ["userId", "owner", "repo"]),

  /** Shared, prebuilt example graphs available to every user. */
  exampleGraphs: defineTable({
    owner: v.string(),
    repo: v.string(),
    label: v.string(),
    nodeCount: v.optional(v.number()),
    edgeCount: v.optional(v.number()),
    communityCount: v.optional(v.number()),
    /** Full graph JSON (may be huge). */
    graphStorageId: v.id("_storage"),
    /** Optional smaller AnalyzeResult for fast interactive viewing. */
    displayGraphStorageId: v.optional(v.id("_storage")),
    reportStorageId: v.optional(v.id("_storage")),
    thumbnailStorageId: v.optional(v.id("_storage")),
    builtAt: v.number(),
  }).index("by_owner_repo", ["owner", "repo"]),

  /** Per-user isometric system maps generated from repo graphs. */
  systemMaps: defineTable({
    userId: v.id("users"),
    owner: v.string(),
    repo: v.string(),
    label: v.string(),
    /** SystemMapSpec JSON string. */
    spec: v.string(),
    model: v.optional(v.string()),
    thumbnailStorageId: v.optional(v.id("_storage")),
    lastViewedAt: v.number(),
  })
    .index("by_user_lastViewed", ["userId", "lastViewedAt"])
    .index("by_user_owner_repo", ["userId", "owner", "repo"]),

  /** Per-user query chat sessions (graph Q&A). */
  queryChats: defineTable({
    userId: v.id("users"),
    title: v.string(),
    owner: v.string(),
    repo: v.string(),
    label: v.string(),
    lastMessageAt: v.number(),
  })
    .index("by_user_lastMessage", ["userId", "lastMessageAt"]),

  queryMessages: defineTable({
    chatId: v.id("queryChats"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    graphContext: v.optional(v.string()),
    /** Structured BFS/DFS visit path for replay on the graph. */
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
  }).index("by_chat", ["chatId"]),

  /** Per-user metering for chat (OpenRouter) and graph builds (Graphify). */
  usageEvents: defineTable({
    userId: v.id("users"),
    kind: v.union(v.literal("chat"), v.literal("graph"), v.literal("map")),
    at: v.number(),
    owner: v.optional(v.string()),
    repo: v.optional(v.string()),
    label: v.optional(v.string()),
    model: v.optional(v.string()),
    chatId: v.optional(v.id("queryChats")),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    nodeCount: v.optional(v.number()),
    edgeCount: v.optional(v.number()),
    cached: v.optional(v.boolean()),
    elapsedMs: v.optional(v.number()),
  })
    .index("by_user_at", ["userId", "at"])
    .index("by_user_kind_at", ["userId", "kind", "at"]),
});
