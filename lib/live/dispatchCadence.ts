/**
 * Live dispatch cadence (Stage 1 of the live-crime mission).
 *
 * The live watcher sends a frame to `/api/analyze` on a FIXED cadence instead of
 * gating on local motion/person/novelty. This module owns that cadence as pure
 * math — no timers, no DOM, no network — so the budget rules are unit-testable
 * and behave identically on the client and the server.
 *
 * Budget model (approved plan): a hard ceiling of 40 requests/min, minus 6/min
 * held back for confirmation calls and incident boosts, leaves 34/min to share
 * across every watched camera, with a per-camera ceiling of 20/min (3s) so a
 * single feed can never be faster than the live cadence.
 *
 * Invariants the rest of the pipeline relies on:
 *   1. Steady-state interval is never below `minSteadyIntervalMs` (3s).
 *   2. The aggregate rate never exceeds the usable budget:
 *      `n * 60_000 / interval(n) <= maxRpm - reserveRpm`.
 *   3. Budget degradation (provider keys exhausted) outranks the incident boost:
 *      retrying an exhausted key faster only produces errors.
 *
 * AMENDMENT to the approved cadence table: its row "4+ cameras -> 7.5s at
 * 8/min" contradicts invariant (2), because five cameras at 8/min is 40/min —
 * the entire ceiling. Four cameras hold the table's 7.5s; from five up the
 * interval grows (5 -> 10s, 8 -> 15s) so the aggregate stays inside the budget.
 */
import { clientEnvInt } from "../shared/env";

export interface CadenceConfig {
  /** Hard ceiling on requests/min across all cameras. */
  readonly maxRpm: number;
  /** Requests/min held back for confirmation calls and boosts. */
  readonly reserveRpm: number;
  /** Fastest steady cadence for a single camera (the live dispatch interval). */
  readonly minSteadyIntervalMs: number;
  /** Cadence for a camera with an open incident. */
  readonly boostIntervalMs: number;
  /**
   * Soft cap on how slow a camera may get. It yields to invariant (2): with
   * enough cameras the budget-derived interval wins, otherwise the grid could
   * never stay inside the request ceiling.
   */
  readonly maxSteadyIntervalMs: number;
  /**
   * Absolute intervals per degradation level: level 1 -> index 0, level 2 ->
   * index 1, and the last entry is sticky for any higher level. Level 0 is the
   * undegraded cadence (`minSteadyIntervalMs`), so the progression the operator
   * sees reads 3s -> 6s -> 12s without the 3s appearing here as a dead entry.
   */
  readonly degradeIntervalsMs: readonly number[];
}

export const CADENCE_DEFAULTS: CadenceConfig = {
  maxRpm: 40,
  reserveRpm: 6,
  minSteadyIntervalMs: 3_000,
  boostIntervalMs: 2_000,
  maxSteadyIntervalMs: 30_000,
  degradeIntervalsMs: [6_000, 12_000],
};

/** Resolve the cadence config: explicit overrides win, then LIVE_* env, then defaults. */
export function resolveCadenceConfig(overrides: Partial<CadenceConfig> = {}): CadenceConfig {
  return {
    maxRpm: overrides.maxRpm ?? clientEnvInt("LIVE_MAX_RPM", CADENCE_DEFAULTS.maxRpm),
    reserveRpm:
      overrides.reserveRpm ?? clientEnvInt("LIVE_VERIFY_RESERVE_RPM", CADENCE_DEFAULTS.reserveRpm),
    minSteadyIntervalMs:
      overrides.minSteadyIntervalMs ??
      clientEnvInt("LIVE_DISPATCH_INTERVAL_MS", CADENCE_DEFAULTS.minSteadyIntervalMs),
    boostIntervalMs:
      overrides.boostIntervalMs ??
      clientEnvInt("LIVE_THREAT_INTERVAL_MS", CADENCE_DEFAULTS.boostIntervalMs),
    maxSteadyIntervalMs: overrides.maxSteadyIntervalMs ?? CADENCE_DEFAULTS.maxSteadyIntervalMs,
    degradeIntervalsMs: overrides.degradeIntervalsMs ?? CADENCE_DEFAULTS.degradeIntervalsMs,
  };
}

export interface CadenceState {
  /** An incident is open on this camera, so it runs on the boosted cadence. */
  readonly incidentActive?: boolean;
  /** Provider-exhaustion level: 0 = normal, 1 = 6s, 2 = 12s, higher = sticky. */
  readonly degradeLevel?: number;
  readonly config?: Partial<CadenceConfig>;
}

/** Steady-state interval for one of `cameras` cameras sharing the budget. */
function steadyIntervalMs(cameras: number, config: CadenceConfig): number {
  const usableRpm = Math.max(1, config.maxRpm - config.reserveRpm);

  // Per-camera ceiling: never faster than the live dispatch interval.
  const perCameraCeiling = Math.max(1, Math.floor(60_000 / config.minSteadyIntervalMs));
  const rate = Math.min(Math.max(1, Math.floor(usableRpm / cameras)), perCameraCeiling);

  // `Math.ceil` keeps both invariants honest: the realized interval is never
  // shorter than either the per-camera rate or the aggregate budget implies.
  const rateIntervalMs = Math.ceil(60_000 / rate);
  const budgetIntervalMs = Math.ceil((60_000 * cameras) / usableRpm);

  const slowestAllowed = Math.max(config.maxSteadyIntervalMs, budgetIntervalMs);
  return Math.min(
    Math.max(rateIntervalMs, budgetIntervalMs, config.minSteadyIntervalMs),
    slowestAllowed,
  );
}

/** Slowest interval the given degradation level allows (level 0 = no floor). */
function degradeFloorMs(level: number, config: CadenceConfig): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const steps = config.degradeIntervalsMs.length
    ? config.degradeIntervalsMs
    : CADENCE_DEFAULTS.degradeIntervalsMs;
  const index = Math.min(Math.floor(level) - 1, steps.length - 1);
  return steps[index] ?? 0;
}

/**
 * Interval between frame dispatches for a camera, given how many cameras share
 * the budget and that camera's boost/degradation state.
 */
export function intervalForCameras(cameraCount: number, state: CadenceState = {}): number {
  const config = resolveCadenceConfig(state.config);
  const cameras = Math.max(1, Math.floor(cameraCount));

  const steady = steadyIntervalMs(cameras, config);
  const base = state.incidentActive ? config.boostIntervalMs : steady;

  return Math.max(base, degradeFloorMs(state.degradeLevel ?? 0, config));
}

export interface ScheduleState {
  /** Epoch ms each camera is next due; cameras absent from the map are new. */
  readonly nextDispatchAt: Readonly<Record<string, number>>;
  /** Cameras with an open incident, which run on the boosted cadence. */
  readonly incidentCameras?: readonly string[];
  /** Provider-exhaustion level applied to every camera. */
  readonly degradeLevel?: number;
  readonly config?: Partial<CadenceConfig>;
}

export interface SchedulePlan {
  /** Cameras whose dispatch slot has arrived, in the order they were passed in. */
  readonly due: readonly string[];
  /** Next-dispatch stamps for exactly the watched cameras (unwatched are pruned). */
  readonly nextDispatchAt: Record<string, number>;
}

/**
 * Pure scheduler: decides which cameras are due and stamps their next slot.
 *
 * A camera with no stamp has never been dispatched and is due immediately. A due
 * camera is always stamped strictly in the future, so repeated calls at the same
 * `now` dispatch it exactly once. Cameras no longer in `cameraIds` are dropped,
 * so a re-added camera is treated as new rather than inheriting a stale slot.
 */
export function planDispatches(
  cameraIds: readonly string[],
  now: number,
  state: ScheduleState,
): SchedulePlan {
  const cameras = Math.max(1, cameraIds.length);
  const incidentCameras = new Set(state.incidentCameras ?? []);
  const due: string[] = [];
  const nextDispatchAt: Record<string, number> = {};

  for (const cameraId of cameraIds) {
    const previous = state.nextDispatchAt[cameraId];
    if (previous === undefined || previous <= now) {
      due.push(cameraId);
      nextDispatchAt[cameraId] =
        now +
        intervalForCameras(cameras, {
          incidentActive: incidentCameras.has(cameraId),
          degradeLevel: state.degradeLevel,
          config: state.config,
        });
    } else {
      nextDispatchAt[cameraId] = previous;
    }
  }

  return { due, nextDispatchAt };
}
