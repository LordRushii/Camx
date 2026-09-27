"use client";

import { useEffect, useRef, useState } from "react";
import type { Detection } from "@/lib/draw";
import { cocoClassName } from "@/lib/coco";
import { getYoloSession } from "@/lib/detection/onnxSession";
import { detectVideoFrame } from "@/lib/detection/detectFrame";
import type { InferenceSession } from "onnxruntime-web";

export interface LiveDetectionState {
  /** Latest detections in the video's natural coordinate space. */
  readonly detections: readonly Detection[];
  /** Natural dimensions of the last sampled frame. */
  readonly frameDims: { readonly w: number; readonly h: number };
  /** Last inference latency in milliseconds (null before first frame). */
  readonly latencyMs: number | null;
  /** Approximate inference FPS based on measured latency. */
  readonly fps: number | null;
  /** Non-fatal inference error, if any. */
  readonly error: string | null;
  readonly isProcessing: boolean;
}

interface UseLiveDetectionOptions {
  /** Video element to sample. */
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Run the inference loop only when true. */
  readonly enabled: boolean;
  /** Throttle between inference ticks in ms (default 200 ≈ 5 FPS). */
  readonly intervalMs?: number;
}

const THREAT_CLASSES = ["weapon", "knife", "handgun", "rifle"];
const WARNING_CLASSES = ["backpack", "cell phone"];

export function detectionSeverity(d: Detection): "critical" | "warning" | "nominal" {
  const className = (typeof d.class === "number" ? cocoClassName(d.class, "yolo") : d.class).toLowerCase();
  if (THREAT_CLASSES.includes(className)) return "critical";
  if (WARNING_CLASSES.includes(className)) return "warning";
  return "nominal";
}

/**
 * Runs the in-browser YOLO11n inference loop against a video element and
 * exposes real detections + latency telemetry. Shared by CameraCard and the
 * Live Monitor page so both show genuine model output.
 */
export function useLiveDetection({
  videoRef,
  enabled,
  intervalMs = 200,
}: UseLiveDetectionOptions): LiveDetectionState {
  const [state, setState] = useState<LiveDetectionState>({
    detections: [],
    frameDims: { w: 640, h: 480 },
    latencyMs: null,
    fps: null,
    error: null,
    isProcessing: false,
  });

  const sessionRef = useRef<InferenceSession | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!enabled) {
      setState((prev) => (prev.detections.length === 0 ? prev : { ...prev, detections: [] }));
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const tick = async () => {
      const videoEl = videoRef.current;
      if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
        if (active) timeoutId = setTimeout(tick, 100);
        return;
      }

      try {
        if (!sessionRef.current) {
          sessionRef.current = await getYoloSession();
          if (!active) return;
        }

        const { detections, latencyMs } = await detectVideoFrame(videoEl, sessionRef.current);
        if (!active) return;

        setState({
          detections,
          frameDims: { w: videoEl.videoWidth, h: videoEl.videoHeight },
          latencyMs,
          fps: latencyMs > 0 ? Math.min(1000 / latencyMs, 1000 / intervalMs) : null,
          error: null,
          isProcessing: false,
        });
      } catch (err) {
        console.warn("[useLiveDetection] inference error:", err);
        if (active) {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : "Unknown inference error",
            isProcessing: false,
          }));
        }
      } finally {
        if (active) timeoutId = setTimeout(tick, intervalMs);
      }
    };

    tick();

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [enabled, intervalMs, videoRef]);

  return state;
}
