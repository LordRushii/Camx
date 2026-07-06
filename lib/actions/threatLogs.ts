"use server";

import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export async function listActiveThreatLogs() {
  return await convexClient.query(api.threatLogs.listActive);
}

export async function listAllThreatLogs() {
  return await convexClient.query(api.threatLogs.listAll);
}

export async function updateThreatLogStatus(
  ids: Id<"threatLogs">[],
  status: "ACTIVE" | "ACKNOWLEDGED" | "ESCALATED" | "FALSE_POSITIVE"
) {
  return await convexClient.mutation(api.threatLogs.updateStatus, { ids, status });
}

export async function createThreatLog(args: {
  requestId: string;
  timestamp: string;
  cameraId: string;
  classification: string;
  confidence: number;
  previewText: string;
  frameSrc?: string | null;
  frameId?: string | null;
  vlmAnalysis: string[];
  verification: {
    applied: boolean;
    matchesPrompt: boolean | null;
    overturned: boolean;
    reason: string | null;
    modelKey: string | null;
    latencyMs: number | null;
  };
  tags?: string[];
}) {
  return await convexClient.mutation(api.threatLogs.create, args);
}
