import { describe, expect, it } from "vitest";
import { evaluateGate, GateInputs } from "../index";
import { CameraGateState } from "../index";

const base: GateInputs = {
  motionScore: 0.2,
  personConf: 0.8,
  hash: "0000000000000001",
  now: 10_000,
};

function state(partial: Partial<CameraGateState> = {}): CameraGateState {
  return {
    prevThumb: null,
    lastSentHash: null,
    lastMotionAt: 0,
    cooldownUntil: 0,
    ...partial,
  };
}

describe("evaluateGate", () => {
  it("passes only when motion AND person AND novelty all hold", () => {
    const r = evaluateGate(base, state(), {});
    expect(r.send).toBe(true);
    expect(r.reasons).toEqual(["motion", "person", "novel"]);
  });

  it("drops when there is no motion", () => {
    const r = evaluateGate({ ...base, motionScore: 0.01 }, state(), {});
    expect(r.send).toBe(false);
    expect(r.reasons).toEqual(["person", "novel"]); // motion absent, person+novel ok
  });

  it("drops when there is no person", () => {
    const r = evaluateGate({ ...base, personConf: 0.2 }, state(), {});
    expect(r.send).toBe(false);
    expect(r.reasons).toEqual(["motion", "novel"]);
  });

  it("drops a near-duplicate scene (Hamming <= sameSceneMax)", () => {
    const s = state({ lastSentHash: "0000000000000003" }); // 2 bits apart
    const r = evaluateGate(base, s, { sameSceneMax: 10 });
    expect(r.send).toBe(false);
    expect(r.novel).toBe(false);
  });

  it("treats a never-sent camera as novel", () => {
    const r = evaluateGate(base, state(), {});
    expect(r.novel).toBe(true);
  });

  it("keeps the gate warm via motion-hold after recent movement", () => {
    // motion now = 0, but lastMotionAt was 1s ago (hold 1.5s) and scene is novel
    const s = state({ lastMotionAt: 9_000 });
    const r = evaluateGate({ ...base, motionScore: 0 }, s, { motionHoldMs: 1500 });
    expect(r.send).toBe(true);
    expect(r.reasons).toContain("motion-hold");
  });

  it("suppresses during cooldown unless the novelty override fires", () => {
    const s = state({ cooldownUntil: 20_000, lastSentHash: "0000000000000000" });
    // Small change: novel=false relative to last sent => suppressed
    const suppressed = evaluateGate({ ...base, hash: "0000000000000002" }, s, { cooldownMs: 10_000 });
    expect(suppressed.send).toBe(false);
    expect(suppressed.cooldownActive).toBe(true);

    // Big scene change (26 bits differ): override fires even inside cooldown
    const override = evaluateGate({ ...base, hash: "03ffffff00000000" }, s, {
      cooldownMs: 10_000,
      noveltyOverride: 25,
    });
    expect(override.send).toBe(true);
    expect(override.cooldownOverride).toBe(true);
  });

  it("respects per-camera config thresholds", () => {
    const r = evaluateGate({ ...base, motionScore: 0.03 }, state(), { motionThreshold: 0.05 });
    expect(r.send).toBe(false);
  });
});
