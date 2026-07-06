"use server";

import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export async function createVideoJob(args: {
  fingerprint: string;
  sourceFileName: string;
  totalFrames: number;
  cache: {
    fingerprint: string;
    cacheHit: boolean;
    source: "memory" | "disk" | "upload";
  };
}) {
  return await convexClient.mutation(api.videoJobs.create, args);
}

export async function updateVideoJobProgress(args: {
  jobId: Id<"videoJobs">;
  status: "idle" | "checking_cache" | "uploading" | "extracting" | "analyzing" | "combining" | "completed" | "error";
  analyzedFrames?: number;
  totalFrames?: number;
  summary?: {
    timelineText: string;
    summaryText: string;
    modelKey: string;
    rawText: string;
  };
  error?: string;
}) {
  return await convexClient.mutation(api.videoJobs.updateProgress, args);
}

export async function getVideoJobByFingerprint(fingerprint: string) {
  return await convexClient.query(api.videoJobs.getByFingerprint, { fingerprint });
}
