/**
 * Cheap motion detector — a free trigger that runs on every frame with no LLM
 * cost. Downscales each frame to a tiny grayscale thumbnail and compares it to
 * the previous frame for the same camera via mean absolute pixel difference.
 *
 * Used to (a) suppress LLM calls on static/idle footage and (b) combine with
 * object presence (person) to open an event.
 */
import sharp from "sharp";

const THUMB = 32; // 32x32 grayscale comparison thumbnail

const prevThumbs = new Map<string, Buffer>();

export interface MotionResult {
  /** Mean absolute pixel difference, normalized 0..1. */
  readonly score: number;
  /** True once we have a previous frame AND score exceeds the threshold. */
  readonly moved: boolean;
}

// Default sensitivity; override via env WATCH_MOTION_THRESHOLD (0..1).
function motionThreshold(): number {
  const raw = Number(process.env.WATCH_MOTION_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.04;
}

/**
 * Compute motion for a camera's latest frame relative to its previous frame.
 * Always updates the stored thumbnail. On the very first frame `moved` is false
 * (no baseline yet) but the thumbnail is recorded for the next comparison.
 */
export async function detectMotion(
  cameraId: string,
  frameBuffer: Buffer,
): Promise<MotionResult> {
  let thumb: Buffer;
  try {
    thumb = await sharp(frameBuffer)
      .removeAlpha()
      .grayscale()
      .resize(THUMB, THUMB, { fit: "fill" })
      .raw()
      .toBuffer();
  } catch {
    // If the frame can't be decoded, treat as no motion but don't crash.
    return { score: 0, moved: false };
  }

  const prev = prevThumbs.get(cameraId);
  prevThumbs.set(cameraId, thumb);

  if (!prev || prev.length !== thumb.length) {
    return { score: 0, moved: false };
  }

  let sum = 0;
  for (let i = 0; i < thumb.length; i++) {
    sum += Math.abs(thumb[i]! - prev[i]!);
  }
  const score = sum / (thumb.length * 255);
  return { score, moved: score >= motionThreshold() };
}

export function clearMotion(cameraId: string): void {
  prevThumbs.delete(cameraId);
}
