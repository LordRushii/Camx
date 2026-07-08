import type { WatchResult } from "../schema.js";

export interface WatchProvider {
  analyzeFrame(
    base64Image: string,
    mimeType: string
  ): Promise<{
    result: WatchResult;
    rawText: string;
    modelKey: string;
  }>;

  verifyHarm(
    base64Image: string,
    mimeType: string,
    description: string
  ): Promise<{
    matchesPrompt: boolean;
    reason: string;
    rawText: string;
    modelKey: string;
    latencyMs: number;
  }>;
}
