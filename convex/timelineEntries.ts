import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { Doc } from "./_generated/dataModel";

export const insert = mutation({
  args: {
    jobId: v.id("videoJobs"),
    frameIndex: v.number(),
    timestampMs: v.number(),
    timestampLabel: v.string(),
    frameAnalysis: v.string(),
    priorFrameAnalysis: v.string(),
    priorVisibleObjects: v.array(v.string()),
    objects: v.record(v.string(), v.string()),
    rawText: v.string(),
    modelKey: v.string(),
    latencyMs: v.number(),
    fromCache: v.boolean(),
    error: v.optional(v.union(v.string(), v.null())),
    llm: v.optional(
      v.object({
        narrative: v.object({
          modelKey: v.string(),
          systemPrompt: v.string(),
          userPrompt: v.string(),
          responseRaw: v.string(),
        }),
        tracking: v.object({
          modelKey: v.string(),
          systemPrompt: v.string(),
          userPrompt: v.string(),
          responseRaw: v.string(),
        }),
      })
    ),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const newId = await ctx.db.insert("timelineEntries", {
      ...args,
      createdAt,
    });
    return newId;
  },
});

export const listByJob = query({
  args: {
    jobId: v.id("videoJobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("timelineEntries")
      .withIndex("by_jobId_and_frameIndex", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("timelineEntries") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const updateEmbedding = mutation({
  args: {
    id: v.id("timelineEntries"),
    embedding: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { embedding: args.embedding });
  },
});

export const vectorSearch = action({
  args: {
    jobId: v.id("videoJobs"),
    queryVector: v.array(v.number()),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<(Doc<"timelineEntries"> & { score: number })[]> => {
    const results = await ctx.vectorSearch("timelineEntries", "by_embedding", {
      vector: args.queryVector,
      limit: args.limit,
      filter: (q) => q.eq("jobId", args.jobId),
    });
    const documents = [];
    for (const result of results) {
      const doc: Doc<"timelineEntries"> | null = await ctx.runQuery(api.timelineEntries.get, { id: result._id });
      if (doc) {
        documents.push({
          ...doc,
          score: result._score,
        });
      }
    }
    return documents;
  },
});
