/**
 * Smart-sampling downscale (Layer 2 send boundary) — 03-FREE-TIER-BUDGET.md §4.1.
 *
 * Frames are downscaled to ~640–768 px on the longest edge and JPEG-encoded at
 * q≈50 before dispatch. The dimension math is pure (unit-testable); the canvas
 * encode is browser-only.
 */

export function scaledDims(w: number, h: number, maxEdge: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/**
 * Draw a video frame scaled to maxEdge on the longest side and return the
 * RGBA pixels (for hashing/gating) plus the offscreen canvas for encoding.
 */
export function drawScaledFrame(
  video: HTMLVideoElement,
  maxEdge: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } {
  const { w, h } = scaledDims(video.videoWidth, video.videoHeight, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Failed to acquire 2D context for frame scaling");
  ctx.drawImage(video, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

/** Encode a canvas as JPEG at the given quality (browser-only). */
export function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL("image/jpeg", quality);
}
