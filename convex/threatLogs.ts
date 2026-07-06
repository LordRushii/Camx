import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

function classifySeverity(confidence: number): "critical" | "warning" | "nominal" {
  if (confidence >= 90) return "critical";
  if (confidence >= 75) return "warning";
  return "nominal";
}

function createClassKey(classification: string): string {
  return (
    classification
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "THREAT"
  );
}

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("threatLogs")
      .withIndex("by_status", (q) => q.eq("status", "ACTIVE"))
      .order("desc")
      .collect();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("threatLogs")
      .order("desc")
      .collect();
  },
});

export const updateStatus = mutation({
  args: {
    ids: v.array(v.id("threatLogs")),
    status: v.union(
      v.literal("ACTIVE"),
      v.literal("ACKNOWLEDGED"),
      v.literal("ESCALATED"),
      v.literal("FALSE_POSITIVE")
    ),
  },
  handler: async (ctx, args) => {
    const timestamp = new Date().toISOString();
    const updatedIds: string[] = [];

    for (const id of args.ids) {
      const log = await ctx.db.get(id);
      if (log) {
        await ctx.db.patch(id, {
          status: args.status,
          updatedAt: timestamp,
        });
        updatedIds.push(id);
      }
    }

    return updatedIds;
  },
});

export const create = mutation({
  args: {
    requestId: v.string(),
    timestamp: v.string(),
    cameraId: v.string(),
    classification: v.string(),
    confidence: v.number(),
    previewText: v.string(),
    frameSrc: v.optional(v.union(v.string(), v.null())),
    frameId: v.optional(v.union(v.string(), v.null())),
    vlmAnalysis: v.array(v.string()),
    verification: v.object({
      applied: v.boolean(),
      matchesPrompt: v.union(v.boolean(), v.null()),
      overturned: v.boolean(),
      reason: v.union(v.string(), v.null()),
      modelKey: v.union(v.string(), v.null()),
      latencyMs: v.union(v.number(), v.null()),
    }),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Check if request already exists
    const existing = await ctx.db
      .query("threatLogs")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .unique();

    if (existing) {
      return existing._id;
    }

    const severity = classifySeverity(args.confidence);
    const classKey = createClassKey(args.classification);
    const timestamp = new Date().toISOString();

    const newId = await ctx.db.insert("threatLogs", {
      requestId: args.requestId,
      timestamp: args.timestamp,
      cameraId: args.cameraId,
      classification: args.classification,
      classKey,
      confidence: args.confidence,
      severity,
      previewText: args.previewText,
      frameSrc: args.frameSrc ?? null,
      frameId: args.frameId ?? null,
      vlmAnalysis: args.vlmAnalysis,
      verification: args.verification,
      status: "ACTIVE",
      tags: args.tags ?? [],
      updatedAt: timestamp,
    });

    return newId;
  },
});
