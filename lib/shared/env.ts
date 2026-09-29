/**
 * Shared env parsing helpers — the single source of truth for numeric env
 * reads across lib/budget, lib/gate, lib/live, and the client hook. Each
 * helper documents its guard so call sites can pick the right semantics.
 */

/** Positive integers only (>=1); used for budgets/caps where 0 would disable the guard. */
export function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Non-negative integers (>=0); used where 0 is a legitimate value (e.g. Hamming 0 = exact match). */
export function envIntOrZero(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

/** Positive finite floats; used for thresholds (motion, confidence). */
export function envFloat(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Client-side integer reads: `process` is undefined in the browser bundle. */
export function clientEnvInt(key: string, fallback: number): number {
  if (typeof process === "undefined") return fallback;
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Client-side reads: `process` is undefined in the browser bundle. */
export function clientEnvFloat(key: string, fallback: number): number {
  if (typeof process === "undefined") return fallback;
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
