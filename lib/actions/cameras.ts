"use server";

import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export async function listCameras() {
  return await convexClient.query(api.cameras.list);
}

export async function upsertCamera(args: {
  id?: Id<"cameras">;
  cameraId: string;
  name: string;
  location: string;
  zone: string;
  sourceType: "device" | "network";
  sourceKey: string;
  sourceUrl: string;
  enabled: boolean;
}) {
  return await convexClient.mutation(api.cameras.upsert, args);
}

export async function removeCamera(id: Id<"cameras">) {
  return await convexClient.mutation(api.cameras.remove, { id });
}
