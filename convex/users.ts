import { query, mutation } from "./_generated/server";

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    return await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();
  },
});

export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Called storeUser without authentication");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();

    const timestamp = new Date().toISOString();

    if (existing) {
      if (existing.name !== identity.name || existing.email !== identity.email) {
        await ctx.db.patch(existing._id, {
          name: identity.name,
          email: identity.email,
          updatedAt: timestamp,
        });
      }
      return existing._id;
    }

    const newId = await ctx.db.insert("users", {
      name: identity.name,
      email: identity.email,
      tokenIdentifier: identity.tokenIdentifier,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return newId;
  },
});
