import { describe, expect, it } from "vitest";
import { pickKeyframe, KeyframeCandidate } from "../keyframe";

function cand(motionScore: number, personConf: number, t: number): KeyframeCandidate {
  return { motionScore, personConf, t, rgba: new Uint8ClampedArray(4), w: 1, h: 1, hash: "0".repeat(16) };
}

describe("pickKeyframe", () => {
  it("returns null for an empty buffer", () => {
    expect(pickKeyframe([])).toBeNull();
  });

  it("picks the highest-motion frame in the window", () => {
    const best = pickKeyframe([cand(0.1, 0.9, 1), cand(0.5, 0.4, 2), cand(0.3, 0.8, 3)]);
    expect(best?.t).toBe(2);
  });

  it("tie-breaks equal motion by higher person confidence", () => {
    const best = pickKeyframe([cand(0.4, 0.6, 1), cand(0.4, 0.9, 2)]);
    expect(best?.t).toBe(2);
  });

  it("tie-breaks equal motion and person by the most recent frame", () => {
    const best = pickKeyframe([cand(0.4, 0.6, 1), cand(0.4, 0.6, 5)]);
    expect(best?.t).toBe(5);
  });

  it("returns the single candidate when only one exists", () => {
    const best = pickKeyframe([cand(0.2, 0.5, 9)]);
    expect(best?.t).toBe(9);
  });
});
