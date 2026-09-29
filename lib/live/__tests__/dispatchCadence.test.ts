import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { intervalForCameras, planDispatches } from "../dispatchCadence";

/**
 * Expected values come from the approved cadence table, not from the
 * implementation: a 40 req/min ceiling with 6/min reserved for confirmation
 * calls leaves 34/min to share across the grid, so one camera runs at 3s, two
 * at ~3.5s, three at ~5.4s and four at 7.5s.
 */
const USABLE_RPM = 40 - 6;

describe("intervalForCameras", () => {
  it("runs a single camera at the 3s live cadence", () => {
    expect(intervalForCameras(1)).toBe(3000);
  });

  it("shares the budget between two cameras (~3.5s each)", () => {
    expect(intervalForCameras(2)).toBeGreaterThanOrEqual(3400);
    expect(intervalForCameras(2)).toBeLessThanOrEqual(3600);
  });

  it("slows a three-camera grid to ~5.4s each", () => {
    expect(intervalForCameras(3)).toBeGreaterThanOrEqual(5300);
    expect(intervalForCameras(3)).toBeLessThanOrEqual(5500);
  });

  it("settles a four-camera grid at 7.5s each", () => {
    expect(intervalForCameras(4)).toBe(7500);
  });

  it("slows a five-camera grid past the table's 7.5s to hold the budget", () => {
    // The approved table lists "4+ cameras | 7.5s | 8/min", but 5 x 8 = 40/min
    // breaks the same plan's 34/min invariant. The invariant wins, and the plan
    // table needs the amendment noted in the module docstring.
    expect(intervalForCameras(5)).toBe(10_000);
    expect((60_000 / intervalForCameras(5)) * 5).toBeLessThanOrEqual(34);
  });

  it("never runs faster than the 3s floor in steady state", () => {
    for (let cameras = 1; cameras <= 12; cameras++) {
      expect(intervalForCameras(cameras)).toBeGreaterThanOrEqual(3000);
    }
  });

  it("keeps the aggregate request rate inside the usable budget", () => {
    for (let cameras = 1; cameras <= 40; cameras++) {
      const requestsPerMinute = (60_000 / intervalForCameras(cameras)) * cameras;
      expect(requestsPerMinute).toBeLessThanOrEqual(USABLE_RPM);
    }
  });
});

describe("incident boost", () => {
  it("boosts the camera with an open incident to 2s", () => {
    expect(intervalForCameras(1, { incidentActive: true })).toBe(2000);
  });

  it("honours an override of the incident boost interval", () => {
    expect(
      intervalForCameras(1, { incidentActive: true, config: { boostIntervalMs: 1500 } }),
    ).toBe(1500);
  });

  it("leaves other cameras on the shared steady cadence", () => {
    expect(intervalForCameras(3, { incidentActive: false })).toBeGreaterThanOrEqual(5300);
  });
});

describe("degradation", () => {
  it("steps down to 6s then 12s when the provider keys are exhausted", () => {
    expect(intervalForCameras(1, { degradeLevel: 1 })).toBe(6000);
    expect(intervalForCameras(1, { degradeLevel: 2 })).toBe(12000);
  });

  it("stays at the slowest step beyond the last level", () => {
    expect(intervalForCameras(1, { degradeLevel: 9 })).toBe(12000);
  });

  it("lets budget degradation win over the incident boost", () => {
    expect(intervalForCameras(1, { incidentActive: true, degradeLevel: 1 })).toBe(6000);
  });

  it("keeps an already-slow grid at the degraded interval", () => {
    expect(intervalForCameras(3, { degradeLevel: 1 })).toBe(6000);
  });

  it("honours an override of the degradation steps", () => {
    const config = { degradeIntervalsMs: [8000, 20000] };

    expect(intervalForCameras(1, { degradeLevel: 1, config })).toBe(8000);
    expect(intervalForCameras(1, { degradeLevel: 2, config })).toBe(20000);
  });
});

describe("configuration", () => {
  // Env is saved and restored rather than deleted, so a value the surrounding
  // environment set is not clobbered by running the suite.
  const ENV_KEYS = ["LIVE_MAX_RPM", "LIVE_VERIFY_RESERVE_RPM"] as const;
  const previousEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const previous = previousEnv.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    previousEnv.clear();
  });

  it("honours overrides for the request ceiling and the reserve", () => {
    expect(intervalForCameras(1, { config: { maxRpm: 20, reserveRpm: 0 } })).toBe(3000);
    expect(intervalForCameras(1, { config: { maxRpm: 12, reserveRpm: 2 } })).toBe(6000);
  });

  it("honours an override of the live dispatch interval", () => {
    expect(intervalForCameras(1, { config: { minSteadyIntervalMs: 4000 } })).toBe(4000);
  });

  it("reads the cadence budget from the environment when not overridden", () => {
    process.env.LIVE_MAX_RPM = "60";
    process.env.LIVE_VERIFY_RESERVE_RPM = "10";

    // 50/min for one camera is still capped by the 3s live floor.
    expect(intervalForCameras(1)).toBe(3000);
    // 50/min across five cameras => 10/min each => 6s.
    expect(intervalForCameras(5)).toBe(6000);
  });
});

describe("planDispatches", () => {
  it("marks a camera it has never seen due immediately and stamps the next slot", () => {
    const plan = planDispatches(["cam-a"], 1_000, { nextDispatchAt: {} });
    expect(plan.due).toEqual(["cam-a"]);
    expect(plan.nextDispatchAt["cam-a"]).toBe(4_000);
  });

  it("does not re-dispatch the same camera twice at one timestamp", () => {
    const first = planDispatches(["cam-a"], 1_000, { nextDispatchAt: {} });
    const second = planDispatches(["cam-a"], 1_000, { nextDispatchAt: first.nextDispatchAt });
    expect(second.due).toEqual([]);
    expect(second.nextDispatchAt["cam-a"]).toBe(4_000);
  });

  it("dispatches again once the stamped slot arrives, always moving forward", () => {
    const first = planDispatches(["cam-a"], 1_000, { nextDispatchAt: {} });
    const second = planDispatches(["cam-a"], 4_000, { nextDispatchAt: first.nextDispatchAt });
    expect(second.due).toEqual(["cam-a"]);
    expect(second.nextDispatchAt["cam-a"]).toBe(7_000);
  });

  it("reports due cameras in the order they were passed in", () => {
    const plan = planDispatches(["cam-b", "cam-a"], 500, { nextDispatchAt: {} });
    expect(plan.due).toEqual(["cam-b", "cam-a"]);
  });

  it("boosts only the camera with the open incident", () => {
    const plan = planDispatches(["cam-a", "cam-b"], 0, {
      nextDispatchAt: {},
      incidentCameras: ["cam-a"],
    });
    expect(plan.nextDispatchAt["cam-a"]).toBe(2000);
    expect(plan.nextDispatchAt["cam-b"]).toBe(3530);
  });

  it("spaces dispatches out when the budget is degraded", () => {
    const plan = planDispatches(["cam-a"], 0, { nextDispatchAt: {}, degradeLevel: 1 });
    expect(plan.nextDispatchAt["cam-a"]).toBe(6000);
  });

  it("prunes cameras that are no longer watched", () => {
    const twoCams = planDispatches(["cam-a", "cam-b"], 0, { nextDispatchAt: {} });
    const oneCam = planDispatches(["cam-a"], 1_000, { nextDispatchAt: twoCams.nextDispatchAt });
    expect(Object.keys(oneCam.nextDispatchAt)).toEqual(["cam-a"]);
    expect(oneCam.due).toEqual([]);

    // A camera that comes back has no stamp left, so it is treated as new.
    const readded = planDispatches(["cam-a", "cam-b"], 1_000, {
      nextDispatchAt: oneCam.nextDispatchAt,
    });
    expect(readded.due).toEqual(["cam-b"]);
  });
});
