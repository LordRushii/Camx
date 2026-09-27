import { describe, expect, it } from "vitest";
import { TemporalVote } from "../temporalVote";

describe("TemporalVote", () => {
  it("does not alert on a single positive frame (2-of-3 default)", () => {
    const vote = new TemporalVote({ n: 2, m: 3 });
    expect(vote.record(true, 0.6, 1000)).toEqual({ alert: false, votes: 1, needed: 2 });
  });

  it("alerts at the Nth positive within the window", () => {
    const vote = new TemporalVote({ n: 2, m: 3 });
    vote.record(true, 0.6, 1000);
    expect(vote.record(true, 0.6, 1500)).toEqual({ alert: true, votes: 2, needed: 2 });
  });

  it("ignores negatives but keeps them within the M-window", () => {
    const vote = new TemporalVote({ n: 2, m: 3 });
    vote.record(true, 0.6, 1000);
    vote.record(false, 0.1, 1200);
    const r = vote.record(true, 0.6, 1400); // 3 frames now: pos, neg, pos
    expect(r).toEqual({ alert: true, votes: 2, needed: 2 });
  });

  it("evicts positives that fall outside the M-window", () => {
    const vote = new TemporalVote({ n: 2, m: 3, windowMs: 5000 });
    vote.record(true, 0.6, 1000);
    // Next positive is 6s later — the first fell out of the window.
    expect(vote.record(true, 0.6, 7100)).toEqual({ alert: false, votes: 1, needed: 2 });
  });

  it("high-confidence positives bypass the vote", () => {
    const vote = new TemporalVote({ n: 2, m: 3, bypassConfidence: 0.9 });
    expect(vote.record(true, 0.95, 1000)).toEqual({ alert: true, votes: 1, needed: 1, bypass: true });
  });

  it("resets after alerting so a sustained event does not re-alert every frame", () => {
    const vote = new TemporalVote({ n: 2, m: 3 });
    vote.record(true, 0.6, 1000);
    expect(vote.record(true, 0.6, 1500).alert).toBe(true);
    // After the alert, the counter restarts.
    expect(vote.record(true, 0.6, 1800)).toEqual({ alert: false, votes: 1, needed: 2 });
  });
});
