import type { WatchResult } from "../schema.js";

export interface BurstFrame {
  readonly base64: string;
  readonly mimeType: string;
}

export interface WatchProvider {
  analyzeFrame(
    base64Image: string,
    mimeType: string
  ): Promise<{
    result: WatchResult;
    rawText: string;
    modelKey: string;
  }>;

  /**
   * Analyze an ordered burst of frames (oldest first) in a single call,
   * with on-device detector context. Gives the model temporal context.
   */
  analyzeBurst(
    frames: BurstFrame[],
    context: string
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
