import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("cameras").collect();
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("cameras")),
    cameraId: v.string(),
    name: v.string(),
    location: v.string(),
    zone: v.string(),
    sourceType: v.union(v.literal("device"), v.literal("network")),
    sourceKey: v.string(),
    sourceUrl: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const timestamp = new Date().toISOString();

    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (existing) {
        const { id: _id, ...updateFields } = args;
        await ctx.db.patch(args.id, {
          ...updateFields,
          updatedAt: timestamp,
        });
        return args.id;
      }
    }

    const existingByCameraId = await ctx.db
      .query("cameras")
      .withIndex("by_cameraId", (q) => q.eq("cameraId", args.cameraId))
      .unique();

    if (existingByCameraId) {
      const { id: _id, ...updateFields } = args;
      await ctx.db.patch(existingByCameraId._id, {
        ...updateFields,
        updatedAt: timestamp,
      });
      return existingByCameraId._id;
    }

    const { id: _id, ...insertFields } = args;
    const newId = await ctx.db.insert("cameras", {
      ...insertFields,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return newId;
  },
});

export const remove = mutation({
  args: {
    id: v.id("cameras"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return args.id;
  },
});
