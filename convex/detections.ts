import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const push = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const newId = await ctx.db.insert("detections", {
      cameraId: args.cameraId,
      detections: args.detections,
      frame: args.frame,
      createdAt,
    });
    return newId;
  },
});

export const recentByCamera = query({
  args: {
    cameraId: v.string(),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("detections")
      .withIndex("by_cameraId_and_createdAt", (q) =>
        q.eq("cameraId", args.cameraId).gte("createdAt", args.since)
      )
      .collect();
  },
});
