"use server";

import { convexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";

export async function pushDetections(args: {
  cameraId: string;
  detections: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    confidence: number;
    class: number;
    mask?: {
      width: number;
      height: number;
      data: string;
    };
  }>;
  frame: {
    width: number;
    height: number;
  };
}) {
  return await convexClient.mutation(api.detections.push, args);
}

export async function recentDetectionsByCamera(cameraId: string, since: number) {
  return await convexClient.query(api.detections.recentByCamera, { cameraId, since });
}
