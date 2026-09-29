/**
 * Per-request time budget for the live /api/analyze route.
 *
 * The browser aborts its dispatch at a fixed deadline (see
 * `DISPATCH_TIMEOUT_MS` in hooks/useThreatAnalyzer.ts). Nothing server-side may
 * outlive that deadline, because an aborted fetch means the operator sees
 * "signal timed out" and NO verdict — the exact failure that made a held knife
 * invisible. Before this module the provider chain had no per-call timeout at
 * all, so a single slow or hung provider consumed the entire browser deadline
 * and the triage + verify + persist path could never finish in time.
 *
 * The contract is deliberately narrow: a budget is a deadline, and callers ask
 * it for a timeout to hand ONE provider call. There is no clock, no timer and
 * no I/O here, so the arithmetic (and the "budget spent" decision) is unit
 * tested rather than discovered in production.
 */

/** Tuning knobs, all overridable through the env vars named alongside them. */
export const REQUEST_BUDGET_DEFAULTS = {
  /** Wall clock the route gives the LLM work (triage + verify). `WATCH_REQUEST_BUDGET_MS`. */
  TOTAL_MS: 12_000,
  /** Ceiling for a SINGLE provider call. `WATCH_PROVIDER_TIMEOUT_MS`. */
  PROVIDER_CAP_MS: 7_000,
  /**
   * Shortest call worth starting. Below this, a call would be aborted mid-flight
   * (guaranteed failure) while still costing the provider latency, so a slice
   * that small is reported as 0 and the caller skips instead.
   */
  MIN_SLICE_MS: 750,
  /**
   * A verify pass shorter than this is worse than no verify at all: it would
   * fail-safe to "keep the alert unverified". Skipping it costs nothing and
   * returns the triage verdict ~instantly.
   */
  VERIFY_MIN_MS: 3_000,
  /** Persistence (Convex) gets its own ceiling, floored so a threat is still logged. */
  PERSIST_TIMEOUT_MS: 4_000,
  PERSIST_MIN_MS: 1_500,
} as const;

export interface RequestBudget {
  /** Wall clock the budget started with, in ms. */
  readonly totalMs: number;
  /** Absolute epoch ms after which no provider call may start. */
  readonly deadlineAt: number;
}

/** Start a budget of `totalMs` from `now` (both epoch ms). */
export function createRequestBudget(totalMs: number, now: number): RequestBudget {
  return { totalMs, deadlineAt: now + totalMs };
}

/** Milliseconds left before the deadline; negative once it has passed. */
export function remainingMs(deadlineAt: number, now: number): number {
  return deadlineAt - now;
}

/**
 * Timeout to hand one provider call: the smaller of `capMs` and what is left of
 * the budget. Returns 0 when too little time remains to be worth starting (see
 * MIN_SLICE_MS) — callers MUST treat 0 as "skip this call", never as "0ms
 * timeout", which would abort instantly and burn a fallback hop.
 */
export function sliceTimeoutMs(
  deadlineAt: number,
  now: number,
  capMs: number,
  minSliceMs: number = REQUEST_BUDGET_DEFAULTS.MIN_SLICE_MS,
): number {
  const left = remainingMs(deadlineAt, now);
  if (left < minSliceMs) return 0;
  return Math.max(minSliceMs, Math.min(capMs, left));
}

/**
 * Whether a call of at least `minMs` still fits. Used to decide whether the
 * optional verify pass is worth attempting at all.
 */
export function canAfford(deadlineAt: number, now: number, minMs: number): boolean {
  return remainingMs(deadlineAt, now) >= minMs;
}

/**
 * Append an explicit, human-readable timeout note to a provider error. Provider
 * SDKs report an aborted fetch as the opaque "signal timed out" / "This
 * operation was aborted", which is what the debug panel was showing — the note
 * says which provider hung and for how long, so the operator can act on it.
 */
export function describeProviderTimeout(providerName: string, timeoutMs: number): string {
  return `${providerName} timed out after ${timeoutMs}ms`;
}

/**
 * True when an error came from an aborted/timed-out call rather than a provider
 * rejection. Node reports `AbortSignal.timeout` as a `TimeoutError` DOMException
 * (message "The operation was aborted due to timeout"); older runtimes and
 * undici report the same abort as `AbortError`. Both mean "we gave up waiting".
 */
export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}
