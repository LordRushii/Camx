import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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
