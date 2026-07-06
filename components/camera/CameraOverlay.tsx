"use client";

import { useEffect, useRef } from "react";

export interface Detection {
  readonly bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  readonly class: string;
  readonly confidence: number;
  readonly mask?: readonly (readonly [number, number])[];
}

interface CameraOverlayProps {
  readonly detections: readonly Detection[];
  readonly width?: number;
  readonly height?: number;
}

export function CameraOverlay({ detections, width = 640, height = 480 }: CameraOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Sync drawing buffer dimensions
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear previous drawing
    ctx.clearRect(0, 0, width, height);

    if (detections.length === 0) return;

    // Iterate and draw each detection
    for (const d of detections) {
      const [x1, y1, x2, y2] = d.bbox;
      const w = x2 - x1;
      const h = y2 - y1;

      // Determine color theme based on object class
      const isThreat = ["weapon", "knife", "handgun", "rifle"].includes(d.class.toLowerCase());
      const isWarning = ["backpack", "cell phone"].includes(d.class.toLowerCase());

      const color = isThreat ? "#ef4444" : isWarning ? "#f59e0b" : "#22c55e";
      const fillStyle = isThreat ? "rgba(239, 68, 68, 0.15)" : isWarning ? "rgba(245, 158, 11, 0.1)" : "rgba(34, 197, 94, 0.1)";

      // 1. Draw segmentation mask if present
      if (d.mask && d.mask.length > 0) {
        ctx.beginPath();
        const startPoint = d.mask[0];
        if (startPoint) {
          ctx.moveTo(startPoint[0], startPoint[1]);
          for (let i = 1; i < d.mask.length; i++) {
            const point = d.mask[i];
            if (point) ctx.lineTo(point[0], point[1]);
          }
          ctx.closePath();
          ctx.fillStyle = fillStyle;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = color;
          ctx.stroke();
        }
      }

      // 2. Draw bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, w, h);

      // 3. Draw background overlay for box (only if no mask was filled)
      if (!d.mask) {
        ctx.fillStyle = fillStyle;
        ctx.fillRect(x1, y1, w, h);
      }

      // 4. Draw label tag
      const text = `${d.class.toUpperCase()} ${(d.confidence * 100).toFixed(0)}%`;
      ctx.font = "bold 10px monospace";
      const textWidth = ctx.measureText(text).width;

      ctx.fillStyle = color;
      ctx.fillRect(x1 - 1, y1 - 16, textWidth + 12, 16);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, x1 + 5, y1 - 4);
    }
  }, [detections, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none w-full h-full"
    />
  );
}
