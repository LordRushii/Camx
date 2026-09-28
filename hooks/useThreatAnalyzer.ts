"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { newCameraGateState, updateMotionBaseline, evaluateGate, GATE_DEFAULTS } from "@/lib/gate/index";
import { dHashFromRgba } from "@/lib/gate/phash";
import { pickKeyframe, type KeyframeCandidate } from "@/lib/gate/keyframe";
import { TemporalVote } from "@/lib/gate/temporalVote";
import { drawScaledFrame, canvasToJpeg, scaledDims } from "@/lib/gate/downscale";
import { clientEnvFloat } from "@/lib/shared/env";
import type { Detection } from "@/lib/draw";

/**
 * Live threat-analysis pipeline (Layers 1–3 in the browser).
 *
 * Per tick: sample the video once at dispatch resolution → motion → (only on
 * motion) person check → novelty vs last-sent → cooldown → buffer for
 * keyframe selection → JPEG q50 → POST /api/analyze.
 *
 * The LLM is the detector; this pipeline only decides whether a frame is
 * worth a call. Every stage fails safe: errors never crash the loop. When the
 * YOLO session is unavailable (ORT/WebGPU failure), the gate degrades to
 * motion + novelty with a tighter cooldown instead of going silent (02,
 * failure modes: "fail safe, not open").
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
const KEYFRAME_WINDOW_MS = clientEnvFloat("WATCH_KEYFRAME_WINDOW_MS", 1200);
const DOWNSCALE_PX = clientEnvFloat("WATCH_DOWNSCALE_PX", 896);
const JPEG_QUALITY = Math.max(0, Math.min(1, clientEnvFloat("WATCH_JPEG_QUALITY", 65) / 100));
// Gate work canvas runs at dispatch resolution so the sent JPEG is a true
// downscale of the natural frame (03 §4.1), never an upscaled thumbnail.
const GATE_WORK_PX = DOWNSCALE_PX;
// Degraded mode (YOLO unavailable): tighter cooldown, per the architecture doc.
const DEGRADED_COOLDOWN_MS = 10_000;

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

  const dispatch = useCallback(async (candidate: KeyframeCandidate) => {
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

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cameraId,
          requestId: `live-${cameraId}-${candidate.t}`,
          timestamp: new Date(candidate.t).toISOString(),
          phash: candidate.hash,
          mimeType: "image/jpeg",
          frame: base64,
          gate: {
            personPresent: candidate.personConf >= GATE_DEFAULTS.PERSON_MIN_CONF,
            motionScore: candidate.motionScore,
            personCount: candidate.personCount ?? 0,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 429) {
        const json = (await res.json()) as { reason?: string; budget?: BudgetState };
        setState((p) => ({
          ...p,
          phase: "backoff", // 429: back off, do NOT retry immediately
          budget: json.budget ?? p.budget,
          lastError: json.reason ?? "rate-limited",
          provider: null,
          degraded: false,
        }));
        return;
      }

      if (!res.ok) {
        setState((p) => ({ ...p, phase: "watching", lastError: `analyze-failed:${res.status}` }));
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
        degraded: json.degraded ?? false,
        sentCount: json.cached ? p.sentCount : p.sentCount + 1,
      }));
    } catch (err) {
      setState((p) => ({
        ...p,
        phase: "watching",
        lastError: err instanceof Error ? err.message : "analyze-error",
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
        if (!motion.moved && holdExpired) {
          // No motion, hold expired: cheap exit before hashing/person.
          setState((p) => ({ ...p, phase: p.phase === "analyzing" ? p.phase : "watching" }));
          timeoutId = setTimeout(tick, intervalMs);
          return;
        }

        // Stage 2 — person from the existing YOLO detections (class 0 only).
        // When the YOLO session is unavailable, detections is empty and
        // personConf = -1: degrade to motion + novelty (fail-safe, not open)
        // with a tighter cooldown, instead of never sending (02 failure modes).
        const personDetections = detectionsRef.current.filter((d) => d.class === 0);
        const personConf = personDetections.reduce(
          (max, d) => Math.max(max, d.confidence),
          -1,
        );
        const yoloAvailable = detectionsRef.current.length > 0 || personConf >= 0;

        // Stage 3 — novelty hash (cheap; needed for dedup + cache key).
        const hash = dHashFromRgba(rgba, w, h);

        const decision = evaluateGate(
          { motionScore: motion.score, personConf, hash, now },
          gs,
          yoloAvailable
            ? {}
            : { personMinConf: 0, cooldownMs: DEGRADED_COOLDOWN_MS }, // degraded: motion+novelty only
        );
        setState((p) => ({ ...p, lastGateReasons: decision.reasons }));

        if (!decision.send || inFlightRef.current) {
          timeoutId = setTimeout(tick, intervalMs);
          return;
        }

        // Stage 4 — keyframe window: buffer the candidate, send the best.
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

        const windowElapsed = now - (windowStartRef.current ?? now);
        if (windowElapsed < KEYFRAME_WINDOW_MS) {
          timeoutId = setTimeout(tick, intervalMs);
          return;
        }

        const best = pickKeyframe(bufferRef.current);
        bufferRef.current = [];
        windowStartRef.current = null;

        if (best) {
          // Record the sent hash + open cooldown AFTER picking the keyframe.
          // Cooldown length matches the gate config (WATCH_COOLDOWN_MS via
          // evaluateGate defaults; degraded mode uses the tighter value).
          gs.lastSentHash = best.hash;
          gs.cooldownUntil = now + (yoloAvailable
            ? GATE_DEFAULTS.COOLDOWN_MS
            : DEGRADED_COOLDOWN_MS);
          // If the chosen keyframe had no confident person, this went out via
          // the no-person sweep path; stamp it so the next person-less send
          // waits a full sweep interval (budget guard against YOLO-miss floods).
          if (best.personConf < GATE_DEFAULTS.PERSON_MIN_CONF) {
            gs.lastNoPersonSentAt = now;
          }
          await dispatch(best);
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
