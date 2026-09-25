/**
 * Rolling per-camera frame buffer.
 *
 * Every watch iteration pushes the freshly captured frame here. When the local
 * gate opens an event we pull a burst of recent frames (before -> during) to
 * send to the vision model in a single call, giving it temporal context instead
 * of one isolated frame.
 */

export interface BufferedFrame {
  readonly ts: number; // epoch ms
  readonly buffer: Buffer;
  readonly mimeType: string;
}

// Keep at most this many frames per camera (~ capacity * loop-cadence seconds).
const DEFAULT_CAPACITY = 12;

const buffers = new Map<string, BufferedFrame[]>();

export function pushFrame(
  cameraId: string,
  frame: BufferedFrame,
  capacity: number = DEFAULT_CAPACITY,
): void {
  const list = buffers.get(cameraId) ?? [];
  list.push(frame);
  // Drop oldest beyond capacity.
  if (list.length > capacity) list.splice(0, list.length - capacity);
  buffers.set(cameraId, list);
}

/**
 * Return up to `count` most recent frames, oldest-first (chronological order),
 * evenly sampled across the buffer so the burst spans the whole window rather
 * than only the last few near-identical frames.
 */
export function recentFrames(cameraId: string, count: number): BufferedFrame[] {
  const list = buffers.get(cameraId) ?? [];
  if (list.length <= count) return [...list];

  // Evenly sample `count` indices across the buffer, always including the last.
  const sampled: BufferedFrame[] = [];
  const step = (list.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    const idx = Math.round(i * step);
    sampled.push(list[idx]!);
  }
  return sampled;
}

export function clearCamera(cameraId: string): void {
  buffers.delete(cameraId);
}
