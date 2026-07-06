"use server";

import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export async function insertTimelineEntry(args: {
  jobId: Id<"videoJobs">;
  frameIndex: number;
  timestampMs: number;
  timestampLabel: string;
  frameAnalysis: string;
  priorFrameAnalysis: string;
  priorVisibleObjects: string[];
  objects: Record<string, string>;
  rawText: string;
  modelKey: string;
  latencyMs: number;
  fromCache: boolean;
  error?: string | null;
  llm?: {
    narrative: {
      modelKey: string;
      systemPrompt: string;
      userPrompt: string;
      responseRaw: string;
    };
    tracking: {
      modelKey: string;
      systemPrompt: string;
      userPrompt: string;
      responseRaw: string;
    };
  };
}) {
  return await convexClient.mutation(api.timelineEntries.insert, args);
}

export async function listTimelineEntriesByJob(jobId: Id<"videoJobs">) {
  return await convexClient.query(api.timelineEntries.listByJob, { jobId });
}
