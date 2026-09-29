/**
 * Local gate combiner (Layers 1a+1b+1c) — 05-DETECTION-AND-PROMPTS.md §3.4.
 *
 * A frame reaches the LLM through one of three paths:
 *   1. PRIMARY: motion AND person-present AND scene-novel (vs the last SENT
 *      frame) — the strict AND that keeps idle scenes free.
 *   2. WEAPON TRIGGER: the local model reported a weapon-class hit, which needs
 *      neither motion nor novelty (a held weapon in a still frame). It bypasses
 *      ordinary cooldown but is throttled on its own `lastWeaponSentAt` clock.
 *   3. STATIC SWEEP: a person-present scene that has gone still is re-judged
 *      every `staticSweepMs`, so an unchanged scene is not judged once and
 *      forgotten forever. Empty static scenes never sweep.
 *   Plus a person-less sweep for moving scenes, which catches YOLO person misses.
 *
 * The gate is high-recall: when uncertain it sends. It reduces VOLUME, never the
 * LLM's intelligence — the local weapon hit is only a TRIGGER, and the gate
 * still never answers "weapon?/threat?".
 *
 * Pure decision logic (no DOM, no network) so it is unit-testable; the hook
 * (useThreatAnalyzer) supplies frames and detections and owns the per-camera
 * CameraGateState.
 *
 * NOTE: the live-crime mission supersedes this module — the browser path moves
 * to a fixed 3s dispatch (lib/live/dispatchCadence.ts) and Stage 10 deletes the
 * gate. Do not invest in new gate behaviour.
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
  /**
   * Epoch ms of the last frame dispatched WITHOUT a confident person detection
   * (the "no-person sweep" — catches YOLO false-negatives). Throttled hard so a
   * person-less moving scene can't drain the free-tier budget.
   */
  lastNoPersonSentAt: number;
  /**
   * Epoch ms of the last STATIC-SCENE sweep dispatch (no motion, no novel hash —
   * e.g. a person holding still). These are throttled so an entirely static
   * scene still reaches the LLM periodically instead of never.
   */
  lastStaticSweepAt: number;
  /**
   * Epoch ms of the last WEAPON-TRIGGERED dispatch (local YOLO saw a knife /
   * bat / scissors). Kept separate from cooldownUntil so a weapon hit bypasses
   * ordinary cooldowns while still being rate-throttled on its own clock.
   */
  lastWeaponSentAt: number;
}

export function newCameraGateState(): CameraGateState {
  return {
    prevThumb: null,
    lastSentHash: null,
    lastMotionAt: 0,
    cooldownUntil: 0,
    lastNoPersonSentAt: 0,
    lastStaticSweepAt: 0,
    lastWeaponSentAt: 0,
  };
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
  /**
   * True when the local YOLO gate saw a weapon-class detection (knife, etc.)
   * in the current frame. Local COCO classes are unreliable as a VERDICT but a
   * hit is a cheap, high-value trigger: it opens the gate even when the scene
   * is static and the novelty hash sees nothing.
   */
  weaponFlag?: boolean;
}

export interface GateOptions {
  motionThreshold?: number;
  personMinConf?: number;
  motionHoldMs?: number;
  sameSceneMax?: number;
  cooldownMs?: number;
  noveltyOverride?: number;
  /** Min gap between person-less "sweep" dispatches (catches YOLO misses). */
  noPersonSweepMs?: number;
  /** Min gap between static-scene sweep dispatches (stationary person etc.). */
  staticSweepMs?: number;
  /** Min gap between weapon-triggered dispatches (local weapon hit). */
  weaponSweepMs?: number;
}

export interface GateDecision {
  readonly send: boolean;
  /** Which checks passed (diagnostics: e.g. ["motion", "novel"] without person). */
  readonly reasons: string[];
  readonly novel: boolean;
  readonly cooldownActive: boolean;
  /** Cooldown was bypassed by a big scene change (§3.3 novelty override). */
  readonly cooldownOverride: boolean;
  /** Sent despite no confident person — a YOLO-miss sweep, not a normal send. */
  readonly personFallback: boolean;
  /** Sent despite a static scene — the periodic still-frame sweep. */
  readonly staticSweep: boolean;
  /** Sent because the local model flagged a weapon class (gate forced open). */
  readonly weaponTrigger: boolean;
}

export const GATE_DEFAULTS = {
  MOTION_THRESHOLD: MOTION_THRESHOLD_DEFAULT, // 0.04
  PERSON_MIN_CONF: 0.3, // high-recall floor; browser uses this (env only applies server-side)
  MOTION_HOLD_MS: 1500,
  SAME_SCENE_MAX: 10,
  COOLDOWN_MS: 20_000,
  NOVELTY_OVERRIDE: 25,
  // No-person sweep: local YOLO occasionally misses a real person (occlusion,
  // odd angle, small-in-frame). When a scene is moving + novel but shows no
  // person, still send ONE frame at most this often so the LLM can catch the
  // miss — long enough that a person-less moving scene barely touches budget.
  NO_PERSON_SWEEP_MS: 60_000,
  // Static-scene sweep: a person holding a weapon STILL produces no motion and
  // (after the first send) no novelty — the 9×8 dHash cannot see a small blade.
  // Without this sweep such scenes never reach the LLM again. Send the current
  // frame at most this often so the LLM re-judges genuinely static scenes.
  STATIC_SWEEP_MS: 15_000,
  // Weapon trigger throttle: a local weapon hit forces the gate open, but the
  // hit persists across ticks (the knife stays in frame), so it needs its own
  // re-send interval — fast enough to confirm a real event, slow enough not to
  // burn the free tier (and to stay inside WATCH_RATE_PER_MIN).
  WEAPON_SWEEP_MS: 4_000,
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
    noPersonSweepMs: opts.noPersonSweepMs ?? envInt("WATCH_NO_PERSON_SWEEP_MS", GATE_DEFAULTS.NO_PERSON_SWEEP_MS),
    staticSweepMs: opts.staticSweepMs ?? envInt("WATCH_STATIC_SWEEP_MS", GATE_DEFAULTS.STATIC_SWEEP_MS),
    weaponSweepMs: opts.weaponSweepMs ?? envInt("WATCH_WEAPON_SWEEP_MS", GATE_DEFAULTS.WEAPON_SWEEP_MS),
  };
}

/**
 * Evaluate the gate for a single frame. The caller has already computed
 * motionScore (via detectMotionBrowser), personConf/weaponFlag (from the local
 * detections) and hash (via dHashFromRgba), and updated state.prevThumb /
 * lastMotionAt as appropriate. The caller owns the sweep/weapon clocks it reads.
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

  // Weapon trigger: the local model saw a weapon-class object. This FORCES the
  // gate open — a weapon in a still scene is exactly the frame the strict gate
  // would suppress forever (no motion, no coarse-hash novelty). It bypasses
  // ordinary cooldown but keeps its own re-send interval, because the hit
  // persists across ticks while the weapon stays in frame.
  const weaponDue =
    inputs.weaponFlag === true && inputs.now - state.lastWeaponSentAt >= cfg.weaponSweepMs;
  const staticSweepDue = inputs.now - state.lastStaticSweepAt >= cfg.staticSweepMs;

  const reasons: string[] = [];
  if (inputs.motionScore >= cfg.motionThreshold) reasons.push("motion");
  else if (moving) reasons.push("motion-hold");
  if (person) reasons.push("person");
  if (novel) reasons.push("novel");

  // Primary path — the strict high-recall gate: motion + person + novelty — or
  // a due weapon trigger, which needs neither motion nor novelty.
  const primary = weaponDue || (moving && person && novel && (!cooldownActive || cooldownOverride));

  // Fallback path — no confident person, but a moving, novel scene. YOLO misses
  // people sometimes, so sweep one frame to the LLM at most once per
  // noPersonSweepMs (and never during cooldown) to catch the miss cheaply.
  const sweepDue = inputs.now - state.lastNoPersonSentAt >= cfg.noPersonSweepMs;
  const personFallback = !person && moving && novel && sweepDue && (!cooldownActive || cooldownOverride);
  if (personFallback) reasons.push("no-person-sweep");

  // Static-scene sweep: nothing moved and the scene hash looks unchanged, but
  // the LLM should still re-judge the still frame periodically (a raised knife
  // is invisible to both the motion gate and the coarse dHash).
  // Person-present only: an empty static room has nothing new to judge, so it
  // must not burn budget every sweep interval.
  const stillSweep = !primary && !personFallback && staticSweepDue && person;
  if (stillSweep) reasons.push("static-sweep");
  if (weaponDue) reasons.push("weapon-trigger");

  const send = primary || personFallback || stillSweep;

  return {
    send,
    reasons,
    novel,
    cooldownActive,
    cooldownOverride,
    personFallback,
    staticSweep: stillSweep,
    weaponTrigger: weaponDue,
  };
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
