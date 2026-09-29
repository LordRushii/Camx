import { describe, it, expect } from "vitest";
import {
  REQUEST_BUDGET_DEFAULTS,
  createRequestBudget,
  remainingMs,
  sliceTimeoutMs,
  canAfford,
  describeProviderTimeout,
} from "../requestBudget";

const T0 = 1_700_000_000_000;

describe("createRequestBudget", () => {
  it("puts the deadline totalMs after now", () => {
    const b = createRequestBudget(12_000, T0);
    expect(b.deadlineAt).toBe(T0 + 12_000);
    expect(b.totalMs).toBe(12_000);
  });
});

describe("remainingMs", () => {
  it("counts down and goes negative past the deadline", () => {
    const b = createRequestBudget(10_000, T0);
    expect(remainingMs(b.deadlineAt, T0)).toBe(10_000);
    expect(remainingMs(b.deadlineAt, T0 + 4_000)).toBe(6_000);
    expect(remainingMs(b.deadlineAt, T0 + 11_000)).toBeLessThan(0);
  });
});

describe("sliceTimeoutMs", () => {
  const cap = 7_000;

  it("gives a full cap while the budget is fresh", () => {
    const b = createRequestBudget(12_000, T0);
    expect(sliceTimeoutMs(b.deadlineAt, T0, cap)).toBe(cap);
  });

  it("shrinks the slice to whatever time is actually left", () => {
    const b = createRequestBudget(12_000, T0);
    // 9s spent -> 3s left, less than the 7s cap.
    expect(sliceTimeoutMs(b.deadlineAt, T0 + 9_000, cap)).toBe(3_000);
  });

  it("returns 0 rather than a useless sliver when the budget is nearly spent", () => {
    const b = createRequestBudget(12_000, T0);
    expect(sliceTimeoutMs(b.deadlineAt, T0 + 11_999, cap)).toBe(0);
    expect(sliceTimeoutMs(b.deadlineAt, T0 + 12_000, cap)).toBe(0);
    expect(sliceTimeoutMs(b.deadlineAt, T0 + 30_000, cap)).toBe(0);
  });

  it("still offers a slice exactly at the minimum, and refuses just below it", () => {
    const b = createRequestBudget(12_000, T0);
    expect(sliceTimeoutMs(b.deadlineAt, T0 + 11_250, cap)).toBe(750);
    expect(sliceTimeoutMs(b.deadlineAt, T0 + 11_251, cap)).toBe(0);
  });

  it("never hands out a timeout longer than the time remaining", () => {
    const b = createRequestBudget(12_000, T0);
    for (const spent of [0, 1_000, 5_000, 7_000, 10_000, 11_200]) {
      const slice = sliceTimeoutMs(b.deadlineAt, T0 + spent, cap);
      if (slice > 0) expect(slice).toBeLessThanOrEqual(remainingMs(b.deadlineAt, T0 + spent));
    }
  });

  it("honours a custom minimum slice", () => {
    const b = createRequestBudget(1_000, T0);
    expect(sliceTimeoutMs(b.deadlineAt, T0, cap, 100)).toBe(1_000);
    expect(sliceTimeoutMs(b.deadlineAt, T0, cap, 2_000)).toBe(0);
  });

  it("bounds triage + verify so their sum cannot outlive the budget", () => {
    const total = REQUEST_BUDGET_DEFAULTS.TOTAL_MS;
    const b = createRequestBudget(total, T0);
    const triageSlice = sliceTimeoutMs(b.deadlineAt, T0, REQUEST_BUDGET_DEFAULTS.PROVIDER_CAP_MS);
    // Worst case: triage burns its whole slice, then verify asks again.
    const afterTriage = T0 + triageSlice;
    const verifySlice = sliceTimeoutMs(b.deadlineAt, afterTriage, REQUEST_BUDGET_DEFAULTS.PROVIDER_CAP_MS);
    expect(triageSlice + verifySlice).toBeLessThanOrEqual(total);
  });

  it("leaves no room for a third cloud hop once two caps are spent", () => {
    const b = createRequestBudget(REQUEST_BUDGET_DEFAULTS.TOTAL_MS, T0);
    const spent = 2 * REQUEST_BUDGET_DEFAULTS.PROVIDER_CAP_MS; // 14s > 12s budget
    expect(sliceTimeoutMs(b.deadlineAt, T0 + spent, REQUEST_BUDGET_DEFAULTS.PROVIDER_CAP_MS)).toBe(0);
  });
});

describe("canAfford", () => {
  it("accepts a pass that fits and refuses one that does not", () => {
    const b = createRequestBudget(12_000, T0);
    expect(canAfford(b.deadlineAt, T0, REQUEST_BUDGET_DEFAULTS.VERIFY_MIN_MS)).toBe(true);
    expect(canAfford(b.deadlineAt, T0 + 9_500, REQUEST_BUDGET_DEFAULTS.VERIFY_MIN_MS)).toBe(false);
    // Exactly at the threshold still fits (>=, not >).
    expect(canAfford(b.deadlineAt, T0 + 9_000, REQUEST_BUDGET_DEFAULTS.VERIFY_MIN_MS)).toBe(true);
  });
});

describe("describeProviderTimeout", () => {
  it("names the provider and the elapsed budget instead of 'signal timed out'", () => {
    expect(describeProviderTimeout("gemini", 7_000)).toBe("gemini timed out after 7000ms");
    expect(describeProviderTimeout("gemini", 7_000)).not.toMatch(/signal/);
  });
});

describe("defaults sanity", () => {
  it("keeps the verifier's floor well below a single provider cap", () => {
    expect(REQUEST_BUDGET_DEFAULTS.VERIFY_MIN_MS).toBeLessThan(REQUEST_BUDGET_DEFAULTS.PROVIDER_CAP_MS);
  });

  it("keeps persistence from dominating the request", () => {
    expect(REQUEST_BUDGET_DEFAULTS.PERSIST_TIMEOUT_MS).toBeLessThan(REQUEST_BUDGET_DEFAULTS.TOTAL_MS);
    expect(REQUEST_BUDGET_DEFAULTS.PERSIST_MIN_MS).toBeGreaterThanOrEqual(
      REQUEST_BUDGET_DEFAULTS.MIN_SLICE_MS,
    );
  });
});
