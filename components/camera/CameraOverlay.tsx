"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { drawDetections, type DetectionModel } from "@/lib/draw";

interface CameraOverlayProps {
  readonly cameraId: string;
  readonly isDetectActive: boolean;
  readonly model: DetectionModel;
  readonly width?: number;
  readonly height?: number;
}

export function CameraOverlay({
  cameraId,
  isDetectActive,
  model,
  width = 640,
  height = 480,
}: CameraOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Set up local 'since' timestamp to query recent detections
  // Round to nearest 5s to leverage Convex query caching
  const [since, setSince] = useState(() => Date.now() - 5000);

  useEffect(() => {
    if (!isDetectActive) return;
    const interval = setInterval(() => {
      setSince(Math.floor((Date.now() - 5000) / 5000) * 5000);
    }, 5000);
    return () => clearInterval(interval);
  }, [isDetectActive]);

  // Subscribe to detections push logs in Convex
  const rawDetections = useQuery(
    api.detections.recentByCamera,
    isDetectActive ? { cameraId, since } : "skip"
  );

  const latestDoc =
    rawDetections && rawDetections.length > 0
      ? rawDetections[rawDetections.length - 1]
      : null;

  const detections = latestDoc ? latestDoc.detections : [];
  const frameW = latestDoc?.frame?.width ?? width;
  const frameH = latestDoc?.frame?.height ?? height;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Sync drawing buffer dimensions
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!isDetectActive || detections.length === 0) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    // Draw bounding boxes and segmentation masks
    drawDetections(ctx, detections, {
      frameW,
      frameH,
      model,
    });
  }, [detections, frameW, frameH, model, width, height, isDetectActive]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none w-full h-full"
    />
  );
}

