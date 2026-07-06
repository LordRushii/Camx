"use server";

import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";

export async function getCurrentUser() {
  return await convexClient.query(api.users.current);
}

export async function storeUser() {
  return await convexClient.mutation(api.users.store);
}
