import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  cameras: defineTable({
    cameraId: v.string(),
    name: v.string(),
    location: v.string(),
    zone: v.string(),
    sourceType: v.union(v.literal("device"), v.literal("network")),
    sourceKey: v.string(),
    sourceUrl: v.string(),
    enabled: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_cameraId", ["cameraId"])
    .index("by_enabled", ["enabled"]),

  detections: defineTable({
    cameraId: v.string(),
    detections: v.array(
      v.object({
        x1: v.number(),
        y1: v.number(),
        x2: v.number(),
        y2: v.number(),
        confidence: v.number(),
        class: v.number(),
        mask: v.optional(
          v.object({
            width: v.number(),
            height: v.number(),
            data: v.string(),
          })
        ),
      })
    ),
    frame: v.object({
      width: v.number(),
      height: v.number(),
    }),
    createdAt: v.number(), // timestamp in ms
  }).index("by_cameraId_and_createdAt", ["cameraId", "createdAt"]),

  threatLogs: defineTable({
    requestId: v.string(),
    timestamp: v.string(),
    cameraId: v.string(),
    classification: v.string(),
    classKey: v.string(),
    confidence: v.number(),
    severity: v.union(
      v.literal("critical"),
      v.literal("warning"),
      v.literal("nominal")
    ),
    previewText: v.string(),
    frameSrc: v.union(v.string(), v.null()),
    frameId: v.union(v.string(), v.null()),
    vlmAnalysis: v.array(v.string()),
    verification: v.object({
      applied: v.boolean(),
      matchesPrompt: v.union(v.boolean(), v.null()),
      overturned: v.boolean(),
      reason: v.union(v.string(), v.null()),
      modelKey: v.union(v.string(), v.null()),
      latencyMs: v.union(v.number(), v.null()),
    }),
    status: v.union(
      v.literal("ACTIVE"),
      v.literal("ACKNOWLEDGED"),
      v.literal("ESCALATED"),
      v.literal("FALSE_POSITIVE")
    ),
    tags: v.array(v.string()),
    updatedAt: v.string(),
  })
    .index("by_status", ["status"])
    .index("by_requestId", ["requestId"])
    .index("by_cameraId", ["cameraId"]),

  videoJobs: defineTable({
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
    fingerprint: v.string(),
    sourceFileName: v.string(),
    totalFrames: v.number(),
    analyzedFrames: v.number(),
    cache: v.object({
      fingerprint: v.string(),
      cacheHit: v.boolean(),
      source: v.union(
        v.literal("memory"),
        v.literal("disk"),
        v.literal("upload")
      ),
    }),
    summary: v.optional(
      v.object({
        timelineText: v.string(),
        summaryText: v.string(),
        modelKey: v.string(),
        rawText: v.string(),
      })
    ),
    error: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_fingerprint", ["fingerprint"]),

  timelineEntries: defineTable({
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
    createdAt: v.number(),
    embedding: v.optional(v.array(v.number())),
  })
    .index("by_jobId_and_frameIndex", ["jobId", "frameIndex"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,
      filterFields: ["jobId"],
    }),

  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    tokenIdentifier: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),
});
