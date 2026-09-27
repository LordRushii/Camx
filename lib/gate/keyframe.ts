/**
 * Keyframe selection (Layer 2) — 05-DETECTION-AND-PROMPTS.md §3.4.
 *
 * Don't send the first eligible frame blindly: collect eligible frames over a
 * short window (~2–3 s) and send the single best one — highest motion score
 * (most action), tie-broken by person confidence, then by recency. Yields one
 * crisp, action-carrying frame per window instead of a blurry first-motion one.
 */

export interface KeyframeCandidate {
  /** Mean-abs-diff motion score at capture time. */
  readonly motionScore: number;
  /** Highest person confidence at capture time. */
  readonly personConf: number;
  /** Capture epoch ms. */
  readonly t: number;
  /** Full-resolution RGBA capture of the frame. */
  readonly rgba: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
  /** dHash at capture. */
  readonly hash: string;
  /** Number of person detections at capture (scalar hint, 05 §9). */
  readonly personCount?: number;
}

/**
 * Pick the best candidate: max motionScore → max personConf → latest t.
 * Stable and pure; returns null for an empty buffer.
 */
export function pickKeyframe(buffer: readonly KeyframeCandidate[]): KeyframeCandidate | null {
  if (buffer.length === 0) return null;
  let best = buffer[0]!;
  for (let i = 1; i < buffer.length; i++) {
    const c = buffer[i]!;
    if (
      c.motionScore > best.motionScore ||
      (c.motionScore === best.motionScore &&
        (c.personConf > best.personConf ||
          (c.personConf === best.personConf && c.t >= best.t)))
    ) {
      best = c;
    }
  }
  return best;
}
