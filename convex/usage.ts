import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const recordChat = mutation({
  args: {
    chatId: v.optional(v.id("queryChats")),
    owner: v.optional(v.string()),
    repo: v.optional(v.string()),
    model: v.optional(v.string()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const prompt = Math.max(0, Math.floor(args.promptTokens ?? 0));
    const completion = Math.max(0, Math.floor(args.completionTokens ?? 0));
    const total =
      args.totalTokens != null
        ? Math.max(0, Math.floor(args.totalTokens))
        : prompt + completion;
    return await ctx.db.insert("usageEvents", {
      userId,
      kind: "chat",
      at: Date.now(),
      chatId: args.chatId,
      owner: args.owner,
      repo: args.repo,
      model: args.model,
      promptTokens: prompt || undefined,
      completionTokens: completion || undefined,
      totalTokens: total || undefined,
      costUsd: args.costUsd != null ? Math.max(0, args.costUsd) : 0,
      elapsedMs: args.elapsedMs,
    });
  },
});

export const recordMap = mutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    label: v.optional(v.string()),
    model: v.optional(v.string()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
  },
  returns: v.id("usageEvents"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const prompt = Math.max(0, Math.floor(args.promptTokens ?? 0));
    const completion = Math.max(0, Math.floor(args.completionTokens ?? 0));
    const total =
      args.totalTokens != null
        ? Math.max(0, Math.floor(args.totalTokens))
        : prompt + completion;
    return await ctx.db.insert("usageEvents", {
      userId,
      kind: "map",
      at: Date.now(),
      owner: args.owner.trim(),
      repo: args.repo.trim(),
      label: args.label?.trim() || args.repo.trim(),
      model: args.model,
      promptTokens: prompt || undefined,
      completionTokens: completion || undefined,
      totalTokens: total || undefined,
      costUsd: args.costUsd != null ? Math.max(0, args.costUsd) : 0,
      elapsedMs: args.elapsedMs,
    });
  },
});

export const recordGraph = mutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    label: v.optional(v.string()),
    nodeCount: v.optional(v.number()),
    edgeCount: v.optional(v.number()),
    cached: v.optional(v.boolean()),
    elapsedMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return await ctx.db.insert("usageEvents", {
      userId,
      kind: "graph",
      at: Date.now(),
      owner: args.owner.trim(),
      repo: args.repo.trim(),
      label: args.label?.trim() || args.repo.trim(),
      nodeCount: args.nodeCount,
      edgeCount: args.edgeCount,
      cached: args.cached,
      elapsedMs: args.elapsedMs,
      // Rough compute cost proxy: $0.00001 per node for fresh builds, $0 for cache hits.
      costUsd: args.cached
        ? 0
        : Math.max(0, (args.nodeCount ?? 0) * 0.00001),
    });
  },
});

export const summaryMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const events = await ctx.db
      .query("usageEvents")
      .withIndex("by_user_at", (q) => q.eq("userId", userId))
      .order("desc")
      .take(2000);

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const dayAgo = now - DAY;
    const monthAgo = now - 30 * DAY;
    const prevMonthAgo = now - 60 * DAY;
    const yearAgo = now - 371 * DAY;

    let chatTokens = 0;
    let chatPrompt = 0;
    let chatCompletion = 0;
    let chatCost = 0;
    let chatCount = 0;
    let chatTokensDay = 0;
    let chatCostDay = 0;
    let chatTokensMonth = 0;
    let chatCostMonth = 0;

    let graphBuilds = 0;
    let graphFresh = 0;
    let graphCached = 0;
    let graphNodes = 0;
    let graphCost = 0;
    let graphBuildsDay = 0;
    let graphBuildsMonth = 0;

    let mapCount = 0;
    let mapTokens = 0;
    let mapCost = 0;

    const dayMap = new Map<string, { count: number; chat: number; graph: number }>();

    function dayKey(ts: number): string {
      const d = new Date(ts);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }

    // Rich per-day series for the last 30 days (charts), plus per-model totals
    // and previous-period aggregates for trend deltas.
    type DailyRow = {
      date: string;
      costUsd: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      requests: number;
      chatRequests: number;
      graphBuilds: number;
      byModel: Record<string, number>;
    };
    const dailyMap = new Map<string, DailyRow>();
    for (let i = 29; i >= 0; i--) {
      const key = dayKey(now - i * DAY);
      dailyMap.set(key, {
        date: key,
        costUsd: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requests: 0,
        chatRequests: 0,
        graphBuilds: 0,
        byModel: {},
      });
    }
    const modelTotals = new Map<string, number>();
    const prev = { costUsd: 0, tokens: 0, requests: 0, builds: 0 };
    const cur = { costUsd: 0, tokens: 0, requests: 0, builds: 0 };

    for (const e of events) {
      const isLlm = e.kind === "chat" || e.kind === "map";
      if (e.at >= yearAgo) {
        const key = dayKey(e.at);
        const row = dayMap.get(key) ?? { count: 0, chat: 0, graph: 0 };
        row.count += 1;
        if (e.kind === "graph") row.graph += 1;
        else row.chat += 1;
        dayMap.set(key, row);
      }

      {
        const tokens = isLlm
          ? (e.totalTokens ?? (e.promptTokens ?? 0) + (e.completionTokens ?? 0))
          : 0;
        const cost = e.costUsd ?? 0;
        if (e.at >= monthAgo) {
          cur.costUsd += cost;
          cur.tokens += tokens;
          cur.requests += 1;
          if (e.kind === "graph") cur.builds += 1;

          const daily = dailyMap.get(dayKey(e.at));
          if (daily) {
            daily.costUsd += cost;
            daily.requests += 1;
            if (isLlm) {
              daily.chatRequests += 1;
              daily.promptTokens += e.promptTokens ?? 0;
              daily.completionTokens += e.completionTokens ?? 0;
              daily.totalTokens += tokens;
              const model = e.model || "unknown";
              daily.byModel[model] = (daily.byModel[model] ?? 0) + 1;
              modelTotals.set(model, (modelTotals.get(model) ?? 0) + 1);
            } else {
              daily.graphBuilds += 1;
            }
          }
        } else if (e.at >= prevMonthAgo) {
          prev.costUsd += cost;
          prev.tokens += tokens;
          prev.requests += 1;
          if (e.kind === "graph") prev.builds += 1;
        }
      }

      if (e.kind === "chat") {
        chatCount += 1;
        const tokens = e.totalTokens ?? (e.promptTokens ?? 0) + (e.completionTokens ?? 0);
        const cost = e.costUsd ?? 0;
        chatTokens += tokens;
        chatPrompt += e.promptTokens ?? 0;
        chatCompletion += e.completionTokens ?? 0;
        chatCost += cost;
        if (e.at >= dayAgo) {
          chatTokensDay += tokens;
          chatCostDay += cost;
        }
        if (e.at >= monthAgo) {
          chatTokensMonth += tokens;
          chatCostMonth += cost;
        }
      } else if (e.kind === "map") {
        mapCount += 1;
        mapTokens += e.totalTokens ?? (e.promptTokens ?? 0) + (e.completionTokens ?? 0);
        mapCost += e.costUsd ?? 0;
      } else {
        graphBuilds += 1;
        if (e.cached) graphCached += 1;
        else graphFresh += 1;
        graphNodes += e.nodeCount ?? 0;
        graphCost += e.costUsd ?? 0;
        if (e.at >= dayAgo) graphBuildsDay += 1;
        if (e.at >= monthAgo) graphBuildsMonth += 1;
      }
    }

    const activity = [...dayMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const activeDays = activity.filter((d) => d.count > 0).length;
    const totalActions = activity.reduce((s, d) => s + d.count, 0);

    const topModels = [...modelTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model, count]) => ({ model, count }));

    return {
      daily: [...dailyMap.values()],
      topModels,
      period: { current: cur, previous: prev },
      chat: {
        count: chatCount,
        promptTokens: chatPrompt,
        completionTokens: chatCompletion,
        totalTokens: chatTokens,
        costUsd: chatCost,
        tokensDay: chatTokensDay,
        costDay: chatCostDay,
        tokensMonth: chatTokensMonth,
        costMonth: chatCostMonth,
      },
      graph: {
        builds: graphBuilds,
        fresh: graphFresh,
        cached: graphCached,
        nodesProcessed: graphNodes,
        costUsd: graphCost,
        buildsDay: graphBuildsDay,
        buildsMonth: graphBuildsMonth,
      },
      map: {
        count: mapCount,
        totalTokens: mapTokens,
        costUsd: mapCost,
      },
      activity: {
        days: activity,
        activeDays,
        totalActions,
      },
      recent: events.slice(0, 40),
    };
  },
});
