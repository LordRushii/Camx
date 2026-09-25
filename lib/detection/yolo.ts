import { type Detection } from "@/lib/draw";

// Mirrors apps/worker/detection/postprocess.ts constants for parity with the
// server-side pipeline this replaces.
const DEFAULT_CONF_THRESHOLD = 0.25; // YOLO_CONFIDENCE_THRESHOLD
const DEFAULT_IOU_THRESHOLD = 0.45; // YOLO_NMS_IOU_THRESHOLD
const DEFAULT_MAX_DETECTIONS = 100; // MAX_DETECTIONS
const DEFAULT_INPUT_SIZE = 640;

const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

export interface PostprocessOptions {
  readonly confThreshold?: number;
  readonly iouThreshold?: number;
  readonly maxDetections?: number;
  readonly inputSize?: number;
}

/**
 * Convert an already-resized size×size RGBA buffer (HWC, alpha included) into a
 * [1,3,size,size] CHW Float32Array with values divided by 255. Alpha is dropped.
 * No mean/std normalization (YOLO). Matches the server's fit:"fill" preprocess.
 */
export function rgbaToInputTensor(
  rgba: Uint8ClampedArray,
  size = 640,
): Float32Array {
  const expected = size * size * 4;
  if (rgba.length !== expected) {
    throw new Error(
      `rgbaToInputTensor: expected RGBA buffer of length ${expected} ` +
        `for a ${size}x${size} image, got ${rgba.length}`,
    );
  }

  const planeSize = size * size;
  const floatData = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    const base = i * 4;
    floatData[i] = rgba[base] / 255; // R-plane
    floatData[i + planeSize] = rgba[base + 1] / 255; // G-plane
    floatData[i + 2 * planeSize] = rgba[base + 2] / 255; // B-plane
    // alpha (rgba[base + 3]) intentionally ignored
  }
  return floatData;
}

// Standard box IoU (same logic as worker's intersectionOverUnion).
function intersectionOverUnion(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

// Greedy class-aware NMS (same logic as worker's applyClassAwareNms).
function applyClassAwareNms(
  detections: readonly Detection[],
  iouThreshold: number,
  maxDetections: number,
): Detection[] {
  if (detections.length <= 1) return detections.slice();
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (
      !kept.some(
        (k) => k.class === d.class && intersectionOverUnion(k, d) > iouThreshold,
      )
    ) {
      kept.push(d);
      if (kept.length >= maxDetections) break;
    }
  }
  return kept;
}

/**
 * Decode a YOLO11 "output0" tensor (shape [1, 84, 8400], channel-major) into
 * Detections scaled to the original image. Replicates the server's
 * postprocessYolo exactly (confidence threshold, corner conversion, class-aware
 * NMS) so overlay coordinates match.
 */
export function postprocessYolo(
  output: Float32Array | readonly number[],
  dims: readonly number[],
  origW: number,
  origH: number,
  opts?: PostprocessOptions,
): Detection[] {
  const confThreshold = opts?.confThreshold ?? DEFAULT_CONF_THRESHOLD;
  const iouThreshold = opts?.iouThreshold ?? DEFAULT_IOU_THRESHOLD;
  const maxDetections = opts?.maxDetections ?? DEFAULT_MAX_DETECTIONS;
  const inputSize = opts?.inputSize ?? DEFAULT_INPUT_SIZE;

  if (dims.length !== 3) {
    throw new Error(`postprocessYolo: expected rank-3 dims, got ${JSON.stringify(dims)}`);
  }

  const channelCount = Number(dims[1]);
  const anchorCount = Number(dims[2]);
  if (
    !Number.isFinite(channelCount) ||
    !Number.isFinite(anchorCount) ||
    channelCount < 5 ||
    anchorCount < 1
  ) {
    throw new Error(`postprocessYolo: unexpected dims ${JSON.stringify(dims)}`);
  }

  const classCount = channelCount - 4;
  const xScale = origW / inputSize;
  const yScale = origH / inputSize;
  const detections: Detection[] = [];

  for (let anchor = 0; anchor < anchorCount; anchor++) {
    // Most confident class for this anchor.
    let maxConfidence = -Infinity;
    let maxClass = 0;
    for (let c = 0; c < classCount; c++) {
      const score = Number(output[(c + 4) * anchorCount + anchor] ?? 0);
      if (score > maxConfidence) {
        maxConfidence = score;
        maxClass = c;
      }
    }
    if (!Number.isFinite(maxConfidence) || maxConfidence < confThreshold) continue;

    const cx = Number(output[anchor]);
    const cy = Number(output[anchorCount + anchor]);
    const w = Number(output[2 * anchorCount + anchor]);
    const h = Number(output[3 * anchorCount + anchor]);
    if (![cx, cy, w, h].every(Number.isFinite)) continue;

    const x1 = clamp((cx - w / 2) * xScale, 0, origW);
    const y1 = clamp((cy - h / 2) * yScale, 0, origH);
    const x2 = clamp((cx + w / 2) * xScale, 0, origW);
    const y2 = clamp((cy + h / 2) * yScale, 0, origH);
    if (x2 <= x1 || y2 <= y1) continue;

    detections.push({ x1, y1, x2, y2, confidence: maxConfidence, class: maxClass });
  }

  return applyClassAwareNms(detections, iouThreshold, maxDetections);
}
