"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { drawDetections, type DetectionModel, type Detection } from "@/lib/draw";

interface CameraOverlayProps {
  readonly cameraId: string;
  readonly isDetectActive: boolean;
  readonly model: DetectionModel;
  readonly width?: number;
  readonly height?: number;
  /**
   * Local detections from browser inference. When provided (even an empty
   * array), these are drawn directly and the Convex fallback is skipped. When
   * omitted, the overlay subscribes to server-pushed detections in Convex.
   */
  readonly detections?: readonly Detection[];
  readonly frameWidth?: number;
  readonly frameHeight?: number;
}

export function CameraOverlay({
  cameraId,
  isDetectActive,
  model,
  width = 640,
  height = 480,
  detections: localDetections,
  frameWidth,
  frameHeight,
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

  const useLocal = localDetections !== undefined;

  // Fallback path: subscribe to server-pushed detections in Convex only when
  // no local (browser-inference) detections are supplied by the parent.
  const rawDetections = useQuery(
    api.detections.recentByCamera,
    isDetectActive && !useLocal ? { cameraId, since } : "skip"
  );

  const latestDoc =
    rawDetections && rawDetections.length > 0
      ? rawDetections[rawDetections.length - 1]
      : null;

  const detections = useLocal ? localDetections ?? [] : latestDoc ? latestDoc.detections : [];
  const frameW = useLocal ? frameWidth ?? width : latestDoc?.frame?.width ?? width;
  const frameH = useLocal ? frameHeight ?? height : latestDoc?.frame?.height ?? height;

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

