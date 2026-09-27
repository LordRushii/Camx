/**
 * Browser motion gate (Layer 1a) — 05-DETECTION-AND-PROMPTS.md §3.1.
 *
 * Port of apps/worker/watch/motion.ts to the browser: downscale each frame to
 * a 32×32 grayscale thumbnail and compare with the previous frame via mean
 * absolute pixel difference, normalized 0..1. Pure buffer math (no DOM) so it
 * is unit-testable; the caller draws the video frame into a canvas and passes
 * the ImageData.
 */

const THUMB = 32;

export const MOTION_THRESHOLD_DEFAULT = 0.04;

/** Downscale an RGBA buffer to thumb×thumb grayscale via box sampling. */
export function grayscaleThumb(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  size: number = THUMB,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size);
  for (let ty = 0; ty < size; ty++) {
    // Sample the center pixel of each cell (cheap box-sample).
    const sy = Math.min(h - 1, Math.floor(((ty + 0.5) / size) * h));
    for (let tx = 0; tx < size; tx++) {
      const sx = Math.min(w - 1, Math.floor(((tx + 0.5) / size) * w));
      const i = (sy * w + sx) * 4;
      // ITU-R BT.601 luma.
      out[ty * size + tx] = (rgba[i]! * 299 + rgba[i + 1]! * 587 + rgba[i + 2]! * 114) / 1000;
    }
  }
  return out;
}

/** Mean absolute difference of two equal-length grayscale thumbs, 0..1. */
export function computeMotionScore(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i]! - b[i]!);
  }
  return sum / (a.length * 255);
}

export interface BrowserMotionResult {
  readonly score: number;
  readonly moved: boolean;
}

/**
 * Compute motion for the current RGBA frame vs the previous thumbnail.
 * Mirrors detectMotion(): first frame => moved=false, thumbnail recorded.
 */
export function detectMotionBrowser(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  prevThumb: Uint8ClampedArray | null,
  threshold: number = MOTION_THRESHOLD_DEFAULT,
): { result: BrowserMotionResult; thumb: Uint8ClampedArray } {
  const thumb = grayscaleThumb(rgba, w, h);
  if (!prevThumb) {
    return { result: { score: 0, moved: false }, thumb };
  }
  const score = computeMotionScore(thumb, prevThumb);
  return { result: { score, moved: score >= threshold }, thumb };
}
