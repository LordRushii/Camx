/**
 * Rate limiter + daily budget guard for cloud vision-model calls.
 *
 * The local gate already suppresses idle calls; this is the second line of
 * defense so that a burst of events (or a misfiring gate) can never blow
 * through a free-tier quota or hit 429s. It combines:
 *   - a token bucket (steady calls-per-minute with a small burst allowance),
 *   - a hard daily budget counter (resets at local midnight),
 *   - a concurrency cap (never more than N in-flight calls at once).
 */

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
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
  private readonly maxConcurrent: number;
  private inFlight = 0;
  private usedToday = 0;
  private dayKey = new Date().toDateString();

  constructor() {
    const ratePerMin = envInt("WATCH_RATE_PER_MIN", 12);
    this.bucket = new TokenBucket(ratePerMin, envInt("WATCH_RATE_BURST", 4));
    this.dailyBudget = envInt("WATCH_DAILY_BUDGET", 500);
    this.maxConcurrent = envInt("WATCH_MAX_CONCURRENT", 2);
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
   * string reason if the call should be skipped.
   */
  tryAcquire(): string | null {
    this.rollDay();
    if (this.usedToday >= this.dailyBudget) return "daily-budget-exhausted";
    if (this.inFlight >= this.maxConcurrent) return "max-concurrency";
    if (!this.bucket.tryTake()) return "rate-limited";
    this.inFlight += 1;
    this.usedToday += 1;
    return null;
  }

  release(): void {
    if (this.inFlight > 0) this.inFlight -= 1;
  }

  get stats() {
    return {
      inFlight: this.inFlight,
      usedToday: this.usedToday,
      dailyBudget: this.dailyBudget,
    };
  }
}
