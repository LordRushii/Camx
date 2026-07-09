import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    fingerprint: v.string(),
    sourceFileName: v.string(),
    totalFrames: v.number(),
    cache: v.object({
      fingerprint: v.string(),
      cacheHit: v.boolean(),
      source: v.union(
        v.literal("memory"),
        v.literal("disk"),
        v.literal("upload")
      ),
    }),
  },
  handler: async (ctx, args) => {
    const timestamp = new Date().toISOString();
    const newId = await ctx.db.insert("videoJobs", {
      status: "idle",
      fingerprint: args.fingerprint,
      sourceFileName: args.sourceFileName,
      totalFrames: args.totalFrames,
      analyzedFrames: 0,
      cache: args.cache,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return newId;
  },
});

export const updateProgress = mutation({
  args: {
    jobId: v.id("videoJobs"),
    status: v.union(
      v.literal("idle"),
      v.literal("checking_cache"),
      v.literal("uploading"),
      v.literal("extracting"),
      v.literal("analyzing"),
      v.literal("combining"),
      v.literal("completed"),
      v.literal("error")
    ),
    analyzedFrames: v.optional(v.number()),
    totalFrames: v.optional(v.number()),
    summary: v.optional(
      v.object({
        timelineText: v.string(),
        summaryText: v.string(),
        modelKey: v.string(),
        rawText: v.string(),
      })
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error(`Video job not found: ${args.jobId}`);
    }

    const patchData: {
      status: "idle" | "checking_cache" | "uploading" | "extracting" | "analyzing" | "combining" | "completed" | "error";
      updatedAt: string;
      analyzedFrames?: number;
      totalFrames?: number;
      summary?: {
        timelineText: string;
        summaryText: string;
        modelKey: string;
        rawText: string;
      };
      error?: string;
    } = {
      status: args.status,
      updatedAt: new Date().toISOString(),
    };

    if (args.analyzedFrames !== undefined) {
      patchData.analyzedFrames = args.analyzedFrames;
    }
    if (args.totalFrames !== undefined) {
      patchData.totalFrames = args.totalFrames;
    }
    if (args.summary !== undefined) {
      patchData.summary = args.summary;
    }
    if (args.error !== undefined) {
      patchData.error = args.error;
    }

    await ctx.db.patch(args.jobId, patchData);
    return args.jobId;
  },
});

export const getByFingerprint = query({
  args: {
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("videoJobs")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
      .order("desc")
      .first();
  },
});

export const get = query({
  args: { jobId: v.id("videoJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const uploadFrame = action({
  args: {
    frameBytes: v.bytes(),
  },
  handler: async (ctx, args) => {
    const blob = new Blob([args.frameBytes], { type: "image/png" });
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Failed to get storage URL for uploaded frame");
    return { storageId, url };
  },
});

export const deleteJob = mutation({
  args: { jobId: v.id("videoJobs") },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("timelineEntries")
      .withIndex("by_jobId_and_frameIndex", (q) => q.eq("jobId", args.jobId))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
    await ctx.db.delete(args.jobId);
  },
});
