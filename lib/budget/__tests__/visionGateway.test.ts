import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { VisionCallGateway } from "../visionGateway";

describe("VisionCallGateway", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(overrides: Partial<ConstructorParameters<typeof VisionCallGateway>[0]> = {}) {
    return new VisionCallGateway({
      ratePerMin: 8,
      burst: 4,
      dailyBudget: 500,
      sessionBudget: 500,
      maxConcurrent: 2,
      ...overrides,
    });
  }

  it("allows immediate calls up to the burst capacity", () => {
    const gw = make({ burst: 4, maxConcurrent: 100 });
    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBe("rate-limited");
  });

  it("refills tokens over time (rate/min)", () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);
    const gw = make({ ratePerMin: 60, burst: 2, maxConcurrent: 100 }); // 1 token / second

    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBe("rate-limited");

    // 1 second later: exactly one token refilled
    vi.setSystemTime(start + 1000);
    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBe("rate-limited");
  });

  it("counts usedToday and denies past the daily budget", () => {
    vi.useFakeTimers();
    const start = new Date("2026-09-27T10:00:00");
    vi.setSystemTime(start);
    const gw = make({ ratePerMin: 1000, burst: 10, dailyBudget: 3 });

    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBeNull();
    gw.release();

    expect(gw.tryAcquire()).toBe("daily-budget-exhausted");
    expect(gw.stats.usedToday).toBe(3);
    expect(gw.stats.remaining).toBe(0);
  });

  it("resets the daily counter at local midnight", () => {
    vi.useFakeTimers();
    const start = new Date("2026-09-27T23:59:59");
    vi.setSystemTime(start);
    const gw = make({ ratePerMin: 1000, burst: 10, dailyBudget: 1 });

    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBe("daily-budget-exhausted");

    vi.setSystemTime(new Date("2026-09-28T00:00:01"));
    expect(gw.tryAcquire()).toBeNull();
  });

  it("counts session usage and denies past the session budget", () => {
    const gw = make({ ratePerMin: 1000, burst: 10, dailyBudget: 100, sessionBudget: 2 });
    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBe("session-budget-exhausted");
    expect(gw.stats.sessionUsed).toBe(2);
  });

  it("enforces the concurrency cap (in-flight limit)", () => {
    const gw = make({ maxConcurrent: 2, ratePerMin: 1000, burst: 10 });
    expect(gw.tryAcquire()).toBeNull();
    expect(gw.tryAcquire()).toBeNull();
    expect(gw.tryAcquire()).toBe("max-concurrency");
    gw.release();
    expect(gw.tryAcquire()).toBeNull();
  });

  it("checks budget before rate and concurrency (fail-safe order)", () => {
    const gw = make({ dailyBudget: 0, maxConcurrent: 0, burst: 0 });
    expect(gw.tryAcquire()).toBe("daily-budget-exhausted");
  });

  it("reports stats including remaining budget and warn threshold", () => {
    const gw = make({ dailyBudget: 500, sessionBudget: 500 });
    expect(gw.stats).toMatchObject({
      inFlight: 0,
      usedToday: 0,
      sessionUsed: 0,
      dailyBudget: 500,
      sessionBudget: 500,
      remaining: 500,
    });
    expect(gw.stats.warnPct).toBe(80);
  });

  it("sessionUsedToday never counts towards usedToday but both gate", () => {
    const gw = make({ dailyBudget: 1, sessionBudget: 5 });
    expect(gw.tryAcquire()).toBeNull();
    gw.release();
    expect(gw.tryAcquire()).toBe("daily-budget-exhausted");
  });
});
