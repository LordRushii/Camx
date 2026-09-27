/**
 * Shared budget/rate limiter for cloud vision-model calls (live grid + worker).
 *
 * Browser-safe port of `apps/worker/watch/rateLimiter.ts` (VisionCallGateway),
 * extended per docs/live-detection-plan/03-FREE-TIER-BUDGET.md with a per-session
 * budget counter. It combines, in tryAcquire() order:
 *   1. hard daily budget (resets local midnight) — the fail-safe that cannot be exceeded,
 *   2. per-session budget (resets on server restart),
 *   3. concurrency cap,
 *   4. token bucket (steady calls/min with a small burst allowance).
 *
 * On the server it must be instantiated once per process — use
 * `getSharedVisionGateway()` (hangs the instance off globalThis so Next.js dev
 * hot-reload does not reset the counters mid-demo).
 */
import { envInt } from "../shared/env";

export interface VisionGatewayStats {
  readonly inFlight: number;
  readonly usedToday: number;
  readonly sessionUsed: number;
  readonly dailyBudget: number;
  readonly sessionBudget: number;
  /** dailyBudget - usedToday (floored at 0). */
  readonly remaining: number;
  /** Env WATCH_BUDGET_WARN_PCT (default 80). */
  readonly warnPct: number;
}

export interface VisionGatewayOptions {
  readonly ratePerMin?: number;
  readonly burst?: number;
  readonly dailyBudget?: number;
  readonly sessionBudget?: number;
  readonly maxConcurrent?: number;
}

class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private last: number;

  constructor(ratePerMin: number, capacity: number) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerMs = ratePerMin / 60_000;
    this.last = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (now - this.last) * this.refillPerMs,
    );
    this.last = now;
  }

  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export class VisionCallGateway {
  private readonly bucket: TokenBucket;
  private readonly dailyBudget: number;
  private readonly sessionBudget: number;
  private readonly maxConcurrent: number;
  private inFlight = 0;
  private usedToday = 0;
  private sessionUsed = 0;
  private dayKey = new Date().toDateString();

  constructor(options: VisionGatewayOptions = {}) {
    const ratePerMin = options.ratePerMin ?? envInt("WATCH_RATE_PER_MIN", 8);
    this.bucket = new TokenBucket(
      ratePerMin,
      options.burst ?? envInt("WATCH_RATE_BURST", 4),
    );
    this.dailyBudget = options.dailyBudget ?? envInt("WATCH_DAILY_BUDGET", 500);
    this.sessionBudget =
      options.sessionBudget ?? envInt("WATCH_SESSION_BUDGET", 500);
    this.maxConcurrent =
      options.maxConcurrent ?? envInt("WATCH_MAX_CONCURRENT", 2);
  }

  private rollDay(): void {
    const today = new Date().toDateString();
    if (today !== this.dayKey) {
      this.dayKey = today;
      this.usedToday = 0;
    }
  }

  /**
   * Try to reserve a call slot. Returns null if allowed (and increments
   * in-flight/used counters — the caller MUST call `release()` when done), or a
   * string reason if the call should be skipped:
   * "daily-budget-exhausted" | "session-budget-exhausted" | "max-concurrency" | "rate-limited".
   */
  tryAcquire(): string | null {
    this.rollDay();
    if (this.usedToday >= this.dailyBudget) return "daily-budget-exhausted";
    if (this.sessionUsed >= this.sessionBudget)
      return "session-budget-exhausted";
    if (this.inFlight >= this.maxConcurrent) return "max-concurrency";
    if (!this.bucket.tryTake()) return "rate-limited";
    this.inFlight += 1;
    this.usedToday += 1;
    this.sessionUsed += 1;
    return null;
  }

  release(): void {
    if (this.inFlight > 0) this.inFlight -= 1;
  }

  get stats(): VisionGatewayStats {
    return {
      inFlight: this.inFlight,
      usedToday: this.usedToday,
      sessionUsed: this.sessionUsed,
      dailyBudget: this.dailyBudget,
      sessionBudget: this.sessionBudget,
      remaining: Math.max(0, this.dailyBudget - this.usedToday),
      warnPct: envInt("WATCH_BUDGET_WARN_PCT", 80),
    };
  }
}

// --- Process-wide singleton (survives Next.js dev hot-reload) ---------------

const GLOBAL_KEY = "__camx2_vision_gateway__";

type GatewayGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: VisionCallGateway;
};

/**
 * The shared server-side gateway instance. Hung off globalThis so Next.js dev
 * hot-reload does not reset the budget counters mid-demo (see Phase 1 risks).
 */
export function getSharedVisionGateway(): VisionCallGateway {
  const g = globalThis as GatewayGlobal;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new VisionCallGateway();
  }
  return g[GLOBAL_KEY];
}
