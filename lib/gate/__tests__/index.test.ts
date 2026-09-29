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
    lastNoPersonSentAt: 0,
    lastStaticSweepAt: 0,
    lastWeaponSentAt: 0,
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

  it("sweeps a person-less moving scene when the sweep interval has elapsed", () => {
    // No person, but motion + novel, and the last no-person send was long ago.
    const s = state({ lastNoPersonSentAt: 0 });
    const r = evaluateGate(
      { ...base, personConf: 0.1, now: 100_000 },
      s,
      { noPersonSweepMs: 60_000 },
    );
    expect(r.send).toBe(true);
    expect(r.personFallback).toBe(true);
    expect(r.reasons).toContain("no-person-sweep");
  });

  it("suppresses the no-person sweep before the interval elapses", () => {
    const s = state({ lastNoPersonSentAt: 100_000 });
    const r = evaluateGate(
      { ...base, personConf: 0.1, now: 130_000 }, // only 30s since last sweep
      s,
      { noPersonSweepMs: 60_000 },
    );
    expect(r.send).toBe(false);
    expect(r.personFallback).toBe(false);
  });

  describe("static-scene sweep (still person holding a weapon)", () => {
    const still = { ...base, motionScore: 0, now: 100_000 };

    it("sends a still novel-looking person scene once the sweep is due", () => {
      const s = state({ lastSentHash: base.hash, lastStaticSweepAt: 0 });
      const r = evaluateGate(still, s, { staticSweepMs: 15_000 });
      expect(r.send).toBe(true);
      expect(r.staticSweep).toBe(true);
      expect(r.reasons).toContain("static-sweep");
    });

    it("does not re-send the still scene before the sweep interval elapses", () => {
      const s = state({ lastSentHash: base.hash, lastStaticSweepAt: 95_000 });
      const r = evaluateGate(still, s, { staticSweepMs: 15_000 });
      expect(r.send).toBe(false);
      expect(r.staticSweep).toBe(false);
    });

    it("never sweeps an empty static scene (no person)", () => {
      const s = state({ lastSentHash: base.hash, lastStaticSweepAt: 0 });
      const r = evaluateGate({ ...still, personConf: 0.1 }, s, { staticSweepMs: 15_000 });
      expect(r.send).toBe(false);
    });
  });

  describe("weapon trigger (local YOLO weapon hit)", () => {
    it("forces a send with no motion and no novelty", () => {
      const s = state({ lastSentHash: base.hash, cooldownUntil: 200_000 });
      const r = evaluateGate(
        { ...base, motionScore: 0, weaponFlag: true, now: 100_000 },
        s,
        { weaponSweepMs: 4_000 },
      );
      expect(r.send).toBe(true);
      expect(r.weaponTrigger).toBe(true);
      expect(r.reasons).toContain("weapon-trigger");
    });

    it("is throttled by its own re-send interval while the weapon stays in frame", () => {
      // Both clocks were hit recently: no weapon re-send and no static sweep.
      const s = state({
        lastSentHash: base.hash,
        lastWeaponSentAt: 98_000,
        lastStaticSweepAt: 98_000,
      });
      const r = evaluateGate(
        { ...base, motionScore: 0, weaponFlag: true, now: 100_000 }, // 2s < 4s
        s,
        { weaponSweepMs: 4_000, staticSweepMs: 15_000 },
      );
      expect(r.send).toBe(false);
      expect(r.weaponTrigger).toBe(false);
    });

    it("re-sends once the weapon interval elapses", () => {
      const s = state({ lastSentHash: base.hash, lastWeaponSentAt: 95_000 });
      const r = evaluateGate(
        { ...base, motionScore: 0, weaponFlag: true, now: 100_000 }, // 5s >= 4s
        s,
        { weaponSweepMs: 4_000 },
      );
      expect(r.send).toBe(true);
      expect(r.weaponTrigger).toBe(true);
    });

    it("does not fire when the local model saw no weapon", () => {
      const r = evaluateGate({ ...base, motionScore: 0 }, state(), {});
      expect(r.weaponTrigger).toBe(false);
      expect(r.send).toBe(false);
    });
  });
});
