"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { newCameraGateState, updateMotionBaseline, evaluateGate, GATE_DEFAULTS } from "@/lib/gate/index";
import { dHashFromRgba } from "@/lib/gate/phash";
import { pickKeyframe, type KeyframeCandidate } from "@/lib/gate/keyframe";
import { TemporalVote } from "@/lib/gate/temporalVote";
import { drawScaledFrame, canvasToJpeg, scaledDims } from "@/lib/gate/downscale";
import { clientEnvFloat } from "@/lib/shared/env";
import {
  DISPATCH_TIMEOUT_MS,
  describeDispatchError,
  describeFailedStatus,
  serverFailureDetail,
} from "@/lib/live/dispatchError";
import type { Detection } from "@/lib/draw";

/**
 * Live threat-analysis pipeline (Layers 1–3 in the browser).
 *
 * Per tick: sample the video once at dispatch resolution → motion → person +
 * local weapon-class flag → novelty vs last-sent → gate decision → buffer for
 * keyframe selection (or the newest frame for a weapon trigger) → JPEG q65 →
 * POST /api/analyze.
 *
 * The LLM is the detector; this pipeline only decides whether a frame is worth
 * a call, and it can open for three reasons: the strict motion+person+novelty
 * path, a local weapon-class hit, or a due static-scene sweep. The person and
 * weapon checks therefore run BEFORE the no-motion early exit — a person holding
 * a knife perfectly still produces neither motion nor novelty, and exiting early
 * is exactly how such a frame never reaches the LLM.
 *
 * Every stage fails safe: errors never crash the loop. When the YOLO session is
 * unavailable (ORT/WebGPU failure), the gate degrades to motion + novelty with a
 * tighter cooldown instead of going silent (02, failure modes: "fail safe, not
 * open").
 */

export interface BudgetState {
  readonly usedToday: number;
  readonly sessionUsed: number;
  readonly dailyBudget: number;
  readonly sessionBudget: number;
  readonly remaining: number;
  readonly warnPct: number;
}

export interface AnalyzerVerdict {
  readonly is_threat: boolean;
  readonly threat_type: string;
  readonly description: string;
  readonly confidence: number;
}

export interface ThreatAnalyzerState {
  /** "idle" | "watching" | "analyzing" | "threat" | "backoff" */
  readonly phase: "idle" | "watching" | "analyzing" | "threat" | "backoff";
  readonly lastVerdict: AnalyzerVerdict | null;
  readonly budget: BudgetState | null;
  readonly lastError: string | null;
  /** Provider that answered the last dispatched frame ("cache" on a hit). */
  readonly provider: string | null;
  /**
   * Request id of the last dispatch that reached the server, and its
   * round-trip in ms. This is the LLM call's own telemetry — the local YOLO
   * frame id / inference time is a different number and used to be shown in
   * its place, which made the debug panel actively misleading.
   */
  readonly lastRequestId: string | null;
  readonly lastLatencyMs: number | null;
  /** True when cloud budgets are exhausted and analysis is on LM Studio local. */
  readonly degraded: boolean;
  /** Diagnostics: last gate decision reasons. */
  readonly lastGateReasons: readonly string[];
  /** Calls sent (not cache hits) since mount — demo telemetry. */
  readonly sentCount: number;
}

interface UseThreatAnalyzerOptions {
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Run the pipeline only when true. */
  readonly enabled: boolean;
  /** Camera id used for gate state + dispatch. */
  readonly cameraId: string;
  /** detections from useLiveDetection (YOLO person conf is read from these). */
  readonly detections: readonly Detection[];
  /** Sampling cadence ms (default 500). */
  readonly intervalMs?: number;
}

// Client-side config (NEXT_PUBLIC-independent; these are tuning knobs, not
// secrets). NOTE: WATCH_* are not NEXT_PUBLIC_, so process.env is undefined in
// the browser and clientEnvFloat always returns the fallback here — these
// constants are the effective values. Tune accuracy/latency by editing them.
const KEYFRAME_WINDOW_MS = clientEnvFloat("WATCH_KEYFRAME_WINDOW_MS", 800);
const DOWNSCALE_PX = clientEnvFloat("WATCH_DOWNSCALE_PX", 896);
const JPEG_QUALITY = Math.max(0, Math.min(1, clientEnvFloat("WATCH_JPEG_QUALITY", 65) / 100));
// Gate work canvas runs at dispatch resolution so the sent JPEG is a true
// downscale of the natural frame (03 §4.1), never an upscaled thumbnail.
const GATE_WORK_PX = DOWNSCALE_PX;
// Degraded mode (YOLO unavailable): tighter cooldown, per the architecture doc.
const DEGRADED_COOLDOWN_MS = 10_000;

// Sweep intervals come from the gate's own defaults — never re-declare them
// here, or the hook and the gate drift out of sync (the hook must stamp
// lastStaticSweepAt exactly when a sweep frame goes out, no more often).
const STATIC_SWEEP_MS = GATE_DEFAULTS.STATIC_SWEEP_MS;
const WEAPON_SWEEP_MS = GATE_DEFAULTS.WEAPON_SWEEP_MS;
// Local YOLO COCO indices that are plausible weapons. Unreliable as a verdict,
// but a hit is a strong, free trigger to ask the vision LLM for a real judgment.
const WEAPON_CLASSES = new Set([34, 42, 43, 76]); // baseball bat, fork, knife, scissors

// Two-speed cadence (client-side gate throttle, the dominant limiter):
//  - NOMINAL: an active but non-threat scene sends ~1 frame / 3-4s. Combined
//    with the ~KEYFRAME_WINDOW_MS keyframe buffer this lands in the user's
//    3-4s target while sipping the free tier (idle scenes still send nothing).
//  - THREAT: once the LLM's last verdict is a threat, drop to a fast burst and
//    skip the keyframe window so confirmation frames (N-of-M vote) fly out
//    quickly for a fast alert. The server token bucket (WATCH_RATE_PER_MIN /
//    WATCH_RATE_BURST) is the hard ceiling that keeps the burst bounded.
const NOMINAL_COOLDOWN_MS = 3_000;
const THREAT_COOLDOWN_MS = 1_200;
// Threat pursuit decays: the fast cadence lasts only this long after the most
// recent threat verdict. Without a fresh threat inside the window we fall back
// to nominal — so a stale threat + server 429s/errors can't pin the camera in
// the fast loop forever (the verdict never gets a chance to flip back).
const THREAT_PURSUIT_MS = 15_000;

export function useThreatAnalyzer({
  videoRef,
  enabled,
  cameraId,
  detections,
  intervalMs = 500,
}: UseThreatAnalyzerOptions): ThreatAnalyzerState {
  const [state, setState] = useState<ThreatAnalyzerState>({
    phase: "idle",
    lastVerdict: null,
    budget: null,
    lastError: null,
    provider: null,
    lastRequestId: null,
    lastLatencyMs: null,
    degraded: false,
    lastGateReasons: [],
    sentCount: 0,
  });

  const gateStateRef = useRef(newCameraGateState());
  // Phase 5: N-of-M temporal voting on positive verdicts (high confidence bypasses).
  const voteRef = useRef(new TemporalVote());
  const bufferRef = useRef<KeyframeCandidate[]>([]);
  const windowStartRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const detectionsRef = useRef(detections);
  detectionsRef.current = detections;
  // Threat pursuit: epoch ms of the most recent threat verdict. The tick derives
  // fast cadence from this with a decay (THREAT_PURSUIT_MS) so a stale threat
  // followed by failed sends can't lock the camera into the fast loop.
  const lastThreatAtRef = useRef(0);

  const dispatch = useCallback(async (candidate: KeyframeCandidate, forceFresh = false) => {
    inFlightRef.current = true;
    setState((p) => ({ ...p, phase: "analyzing" }));
    try {
      // The candidate was captured at dispatch resolution, so encoding is a
      // pure JPEG compress of the already-correctly-sized pixels.
      const canvas = document.createElement("canvas");
      canvas.width = candidate.w;
      canvas.height = candidate.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to acquire 2D context for dispatch encoding");
      const img = ctx.createImageData(candidate.w, candidate.h);
      img.data.set(candidate.rgba);
      ctx.putImageData(img, 0, 0);
      const dataUrl = canvasToJpeg(canvas, JPEG_QUALITY);
      const base64 = dataUrl.split(",")[1] ?? "";

      const requestId = `live-${cameraId}-${candidate.t}`;
      const dispatchedAt = Date.now();
      const roundTripMs = () => Date.now() - dispatchedAt;

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cameraId,
          requestId,
          timestamp: new Date(candidate.t).toISOString(),
          phash: candidate.hash,
          mimeType: "image/jpeg",
          frame: base64,
          // Weapon-triggered and sweep frames must bypass the server's negative-
          // verdict cache: a cached "no threat" for a lookalike hash is exactly
          // how a held knife gets silenced.
          forceFresh,
          gate: {
            personPresent: candidate.personConf >= GATE_DEFAULTS.PERSON_MIN_CONF,
            motionScore: candidate.motionScore,
            personCount: candidate.personCount ?? 0,
          },
        }),
        // Above the server's own budget so an abort means the SERVER is wedged,
        // not merely slow — see lib/live/dispatchError.ts.
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      });

      if (res.status === 429) {
        const json = (await res.json()) as { reason?: string; budget?: BudgetState };
        setState((p) => ({
          ...p,
          phase: "backoff", // 429: back off, do NOT retry immediately
          budget: json.budget ?? p.budget,
          lastError: json.reason ?? "rate-limited",
          provider: null,
          lastRequestId: requestId,
          lastLatencyMs: roundTripMs(),
          degraded: false,
        }));
        return;
      }

      if (!res.ok) {
        // The route reports WHY on a 502 (which provider hung, how long it
        // waited); show that instead of a bare status code.
        const detail = await serverFailureDetail(res);
        setState((p) => ({
          ...p,
          phase: "watching",
          lastError: describeFailedStatus(res.status, detail),
          lastRequestId: requestId,
          lastLatencyMs: roundTripMs(),
        }));
        return;
      }

      const json = (await res.json()) as {
        verdict: AnalyzerVerdict;
        budget: BudgetState;
        cached: boolean;
        provider?: string;
        degraded?: boolean;
      };

      // Phase 5: temporal voting — a positive verdict alerts only after N-of-M
      // confirmations, unless confidence is high enough to bypass the vote.
      let phase: ThreatAnalyzerState["phase"] = "watching";
      const verdict = json.verdict;
      if (verdict.is_threat) {
        // Stamp the pursuit clock so the gate keeps the fast cadence while the
        // threat is fresh (decays via THREAT_PURSUIT_MS in the tick).
        lastThreatAtRef.current = Date.now();
        const vote = voteRef.current.record(true, verdict.confidence, Date.now());
        if (!vote.alert) {
          // Vote not yet met: hold the verdict locally, no alert phase.
          phase = "analyzing";
        }
      } else {
        voteRef.current.record(false, verdict.confidence, Date.now());
      }

      setState((p) => ({
        ...p,
        phase,
        lastVerdict: verdict,
        budget: json.budget,
        lastError: null,
        provider: json.provider ?? null,
        lastRequestId: requestId,
        lastLatencyMs: roundTripMs(),
        degraded: json.degraded ?? false,
        sentCount: json.cached ? p.sentCount : p.sentCount + 1,
      }));
    } catch (err) {
      setState((p) => ({
        ...p,
        phase: "watching",
        lastError: describeDispatchError(err),
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, [cameraId]);

  useEffect(() => {
    if (!enabled) {
      setState((p) => (p.phase === "idle" ? p : { ...p, phase: "idle" }));
      return;
    }
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (!active) return;
      const videoEl = videoRef.current;
      if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
        timeoutId = setTimeout(tick, 200);
        return;
      }
      try {
        const now = Date.now();
        const gs = gateStateRef.current;

        // Sample the current frame once, at dispatch resolution — the same
        // pixels serve the gate AND the sent JPEG (no upscale later).
        const { ctx, w, h } = drawScaledFrame(videoEl, GATE_WORK_PX);
        const rgba = ctx.getImageData(0, 0, w, h).data;

        // Stage 1 — motion (updates baseline + hold timer). Threshold comes
        // from WATCH_MOTION_THRESHOLD via evaluateGate defaults; keep the
        // baseline update on the same value for consistency.
        const motion = updateMotionBaseline(gs, rgba, w, h, now);
        const holdExpired = now - gs.lastMotionAt >= GATE_DEFAULTS.MOTION_HOLD_MS;

        // Stage 2 — person + weapon flag from the existing YOLO detections.
        // Person = class 0. Weapon = a weapon-capable COCO class (knife, bat,
        // blades); local COCO classes are unreliable as a VERDICT, but a hit is
        // a cheap gate trigger that forces a frame to the LLM even when the
        // person is perfectly still. When the YOLO session is unavailable,
        // detections is empty: personConf = -1 and weaponFlag = false — the
        // pipeline degrades to motion + novelty (fail-safe, not open).
        const personDetections = detectionsRef.current.filter((d) => d.class === 0);
        const personConf = personDetections.reduce(
          (max, d) => Math.max(max, d.confidence),
          -1,
        );
        // YOLO COCO indices: 34 baseball bat, 42 fork, 43 knife, 76 scissors.
        const weaponFlag = detectionsRef.current.some((d) => WEAPON_CLASSES.has(d.class));
        const yoloAvailable = detectionsRef.current.length > 0 || personConf >= 0;

        // Cheap exit — no motion, hold expired, and NOTHING else pending. A
        // weapon hit or a due static sweep must still reach the full gate: a
        // person standing still holding a knife produces no motion and no
        // novelty, so exiting here is exactly how the weapon never gets seen.
        const stillSweepDue = now - gs.lastStaticSweepAt >= STATIC_SWEEP_MS;
        if (!motion.moved && holdExpired && !weaponFlag && !stillSweepDue) {
          setState((p) => ({ ...p, phase: p.phase === "analyzing" ? p.phase : "watching" }));
          timeoutId = setTimeout(tick, intervalMs);
          return;
        }

        // Stage 3 — novelty hash (cheap; needed for dedup + cache key).
        const hash = dHashFromRgba(rgba, w, h);

        const decision = evaluateGate(
          { motionScore: motion.score, personConf, hash, now, weaponFlag },
          gs,
          // Degraded (YOLO down): motion+novelty only. Cooldown DURATION is set
          // on gs.cooldownUntil below, not here — evaluateGate ignores cooldownMs.
          yoloAvailable ? {} : { personMinConf: 0 },
        );
        setState((p) => ({ ...p, lastGateReasons: decision.reasons }));

        if (!decision.send) {
          // Gate closed: drop any partial keyframe window so a later resume
          // starts fresh instead of dispatching a stale buffered frame.
          bufferRef.current = [];
          windowStartRef.current = null;
          timeoutId = setTimeout(tick, intervalMs);
          return;
        }
        if (inFlightRef.current) {
          timeoutId = setTimeout(tick, intervalMs);
          return;
        }

        // Stage 4 — keyframe window: buffer the candidate, send the best. In
        // threat pursuit the window collapses to 0 so a confirmation frame
        // dispatches immediately (no buffering latency). Pursuit decays: only
        // a threat verdict seen within THREAT_PURSUIT_MS keeps the fast cadence.
        const threatMode = now - lastThreatAtRef.current < THREAT_PURSUIT_MS;
        bufferRef.current.push({
          motionScore: motion.score,
          personConf,
          t: now,
          rgba,
          w,
          h,
          hash,
          personCount: personDetections.length,
        });
        windowStartRef.current ??= now;

        // Threat pursuit and weapon triggers skip the keyframe window: a
        // confirmation frame must fly out immediately, not wait for buffering.
        const windowMs = threatMode || decision.weaponTrigger ? 0 : KEYFRAME_WINDOW_MS;
        const windowElapsed = now - (windowStartRef.current ?? now);
        if (windowElapsed < windowMs) {
          timeoutId = setTimeout(tick, intervalMs);
          return;
        }

        // Weapon trigger: send the NEWEST frame — the object as it is held up
        // right now. The motion-max keyframe is the blurriest one, the worst
        // possible choice for judging "is this a knife".
        const best = decision.weaponTrigger
          ? bufferRef.current[bufferRef.current.length - 1]!
          : pickKeyframe(bufferRef.current);
        bufferRef.current = [];
        windowStartRef.current = null;

        if (best) {
          // Record the sent hash + open cooldown AFTER picking the keyframe.
          // Cadence is adaptive:
          //  - weapon trigger: its own fast re-send clock (WEAPON_SWEEP_MS),
          //  - static sweep: the engine's re-judge interval, stamped so the
          //    still scene is not re-sent on every 500ms tick,
          //  - fast during threat pursuit, ~3-4s nominal, 10s degraded.
          const cooldownMs = !yoloAvailable
            ? DEGRADED_COOLDOWN_MS
            : decision.weaponTrigger
              ? WEAPON_SWEEP_MS
              : decision.staticSweep
                ? STATIC_SWEEP_MS
                : threatMode
                  ? THREAT_COOLDOWN_MS
                  : NOMINAL_COOLDOWN_MS;
          gs.lastSentHash = best.hash;
          gs.cooldownUntil = now + cooldownMs;
          if (decision.weaponTrigger) gs.lastWeaponSentAt = now;
          if (decision.staticSweep) gs.lastStaticSweepAt = now;
          // If the chosen keyframe had no confident person, this went out via
          // the no-person sweep path; stamp it so the next person-less send
          // waits a full sweep interval (budget guard against YOLO-miss floods).
          if (best.personConf < GATE_DEFAULTS.PERSON_MIN_CONF) {
            gs.lastNoPersonSentAt = now;
          }
          await dispatch(best, decision.weaponTrigger);
        }
      } catch (err) {
        console.warn("[useThreatAnalyzer] gate error:", err);
        setState((p) => ({ ...p, lastError: err instanceof Error ? err.message : "gate-error" }));
      } finally {
        if (active && !timeoutId) timeoutId = setTimeout(tick, intervalMs);
      }
    };

    tick();
    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [enabled, intervalMs, videoRef, dispatch]);

  return state;
}

// scaledDims is re-exported for consumers that need dispatch-dimension math.
export { scaledDims };
