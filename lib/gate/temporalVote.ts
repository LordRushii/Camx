/**
 * Temporal N-of-M voting (Phase 5, optional quality polish).
 *
 * Require a threat verdict to persist across N of the last M frames before
 * alerting, cutting single-frame false alarms. Very high-confidence positives
 * bypass the vote (05-DETECTION-AND-PROMPTS.md §5 spirit: don't add latency
 * to what is obviously a weapon).
 *
 * Pure state machine (no timers): the caller passes the frame timestamp.
 */

export interface VoteOptions {
  /** Positives required before alerting (default 2). */
  readonly n?: number;
  /** Window of recent frames considered (default 3). */
  readonly m?: number;
  /** Sliding window duration in ms (default 10_000). */
  readonly windowMs?: number;
  /** Confidence at or above which the vote is bypassed (default 0.9). */
  readonly bypassConfidence?: number;
}

export interface VoteResult {
  readonly alert: boolean;
  /** Positives counted within the window. */
  readonly votes: number;
  readonly needed: number;
  /** True when the confidence bypass fired. */
  readonly bypass?: boolean;
}

export class TemporalVote {
  private readonly n: number;
  private readonly m: number;
  private readonly windowMs: number;
  private readonly bypassConfidence: number;
  private readonly positives: number[] = [];

  constructor(options: VoteOptions = {}) {
    this.n = options.n ?? 2;
    this.m = options.m ?? 3;
    this.windowMs = options.windowMs ?? 10_000;
    this.bypassConfidence = options.bypassConfidence ?? 0.9;
  }

  record(isThreat: boolean, confidence: number, t: number): VoteResult {
    if (isThreat && confidence >= this.bypassConfidence) {
      this.reset();
      return { alert: true, votes: 1, needed: 1, bypass: true };
    }

    if (isThreat) {
      this.positives.push(t);
    }

    // Keep only the last M frames worth of positives inside the window.
    while (this.positives.length > this.m) this.positives.shift();
    while (this.positives.length > 0 && t - this.positives[0]! > this.windowMs) {
      this.positives.shift();
    }

    if (this.positives.length >= this.n) {
      this.reset(); // one alert per confirmed sequence
      return { alert: true, votes: this.n, needed: this.n };
    }
    return { alert: false, votes: this.positives.length, needed: this.n };
  }

  reset(): void {
    this.positives.length = 0;
  }
}
