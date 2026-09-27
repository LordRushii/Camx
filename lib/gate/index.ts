/**
 * Local gate combiner (Layers 1a+1b+1c) — 05-DETECTION-AND-PROMPTS.md §3.4.
 *
 * Strict AND: a frame is worth an LLM call only when
 *   motion AND person-present AND scene-novel (vs the last SENT frame).
 *
 * The gate is high-recall: when uncertain it sends. It reduces VOLUME,
 * never the LLM's intelligence — it never answers "weapon?/threat?".
 *
 * Pure decision logic (no DOM, no network) so it is unit-testable; the
 * hook (useLiveDetection) supplies frames and detections and owns the
 * per-camera CameraGateState.
 */
import { detectMotionBrowser, MOTION_THRESHOLD_DEFAULT } from "./motion";
import { hammingHex } from "./phash";
import { envFloat, envInt } from "../shared/env";

export interface CameraGateState {
  /** Previous 32×32 grayscale thumb (motion baseline). */
  prevThumb: Uint8ClampedArray | null;
  /** dHash of the last frame actually dispatched to the LLM. */
  lastSentHash: string | null;
  /** Epoch ms of the last frame with real movement. */
  lastMotionAt: number;
  /** Epoch ms until which dispatches are suppressed. */
  cooldownUntil: number;
}

export function newCameraGateState(): CameraGateState {
  return { prevThumb: null, lastSentHash: null, lastMotionAt: 0, cooldownUntil: 0 };
}

export interface GateInputs {
  /** Mean-abs-diff score of the current frame vs the previous frame (0..1). */
  motionScore: number;
  /** Highest YOLO `person` confidence in the frame (-1 when not run). */
  personConf: number;
  /** dHash hex of the current frame. */
  hash: string;
  /** Current epoch ms. */
  now: number;
}

export interface GateOptions {
  motionThreshold?: number;
  personMinConf?: number;
  motionHoldMs?: number;
  sameSceneMax?: number;
  cooldownMs?: number;
  noveltyOverride?: number;
}

export interface GateDecision {
  readonly send: boolean;
  /** Which checks passed (diagnostics: e.g. ["motion", "novel"] without person). */
  readonly reasons: string[];
  readonly novel: boolean;
  readonly cooldownActive: boolean;
  /** Cooldown was bypassed by a big scene change (§3.3 novelty override). */
  readonly cooldownOverride: boolean;
}

export const GATE_DEFAULTS = {
  MOTION_THRESHOLD: MOTION_THRESHOLD_DEFAULT, // 0.04
  PERSON_MIN_CONF: 0.35,
  MOTION_HOLD_MS: 1500,
  SAME_SCENE_MAX: 10,
  COOLDOWN_MS: 20_000,
  NOVELTY_OVERRIDE: 25,
};

/**
 * Resolve gate options: explicit options win, then the documented WATCH_* env
 * overrides (05 §3.5 / .env.example), then the tuned defaults. This is what
 * makes the demo tunable without a rebuild.
 */
function resolveOptions(opts: GateOptions): Required<GateOptions> {
  return {
    motionThreshold: opts.motionThreshold ?? envFloat("WATCH_MOTION_THRESHOLD", GATE_DEFAULTS.MOTION_THRESHOLD),
    personMinConf: opts.personMinConf ?? envFloat("WATCH_GATE_MIN_CONF", GATE_DEFAULTS.PERSON_MIN_CONF),
    motionHoldMs: opts.motionHoldMs ?? envInt("WATCH_MOTION_HOLD_MS", GATE_DEFAULTS.MOTION_HOLD_MS),
    sameSceneMax: opts.sameSceneMax ?? envInt("WATCH_PHASH_HAMMING", GATE_DEFAULTS.SAME_SCENE_MAX),
    cooldownMs: opts.cooldownMs ?? envInt("WATCH_COOLDOWN_MS", GATE_DEFAULTS.COOLDOWN_MS),
    noveltyOverride: opts.noveltyOverride ?? envInt("WATCH_NOVELTY_OVERRIDE", GATE_DEFAULTS.NOVELTY_OVERRIDE),
  };
}

/**
 * Evaluate the three-stage gate for a single frame. The caller has already
 * computed motionScore (via detectMotionBrowser) and hash (via dHashFromRgba)
 * and updated state.prevThumb/lastMotionAt as appropriate.
 */
export function evaluateGate(
  inputs: GateInputs,
  state: CameraGateState,
  options: GateOptions,
): GateDecision {
  const cfg = resolveOptions(options);

  // Stage 1 — motion (with hold debounce).
  const moving =
    inputs.motionScore >= cfg.motionThreshold ||
    inputs.now - state.lastMotionAt < cfg.motionHoldMs;

  // Stage 2 — person presence (YOLO class 0 above the recall-friendly floor).
  const person = inputs.personConf >= cfg.personMinConf;

  // Stage 3 — novelty vs the last frame actually SENT.
  const novel =
    state.lastSentHash === null ||
    hammingHex(inputs.hash, state.lastSentHash) > cfg.sameSceneMax;

  // Cooldown: suppress unless a big scene change forces it through.
  const cooldownActive = inputs.now < state.cooldownUntil;
  const bigChange =
    state.lastSentHash !== null &&
    hammingHex(inputs.hash, state.lastSentHash) >= cfg.noveltyOverride;
  const cooldownOverride = cooldownActive && bigChange;

  const reasons: string[] = [];
  if (inputs.motionScore >= cfg.motionThreshold) reasons.push("motion");
  else if (moving) reasons.push("motion-hold");
  if (person) reasons.push("person");
  if (novel) reasons.push("novel");

  const send = moving && person && novel && (!cooldownActive || cooldownOverride);

  return { send, reasons, novel, cooldownActive, cooldownOverride };
}

/** Stage-1 helper used by the hook: updates the motion baseline and hold timer. */
export function updateMotionBaseline(
  state: CameraGateState,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  now: number,
  threshold: number = GATE_DEFAULTS.MOTION_THRESHOLD,
): { score: number; moved: boolean } {
  const { result, thumb } = detectMotionBrowser(rgba, w, h, state.prevThumb, threshold);
  state.prevThumb = thumb;
  if (result.moved) state.lastMotionAt = now;
  return result;
}
