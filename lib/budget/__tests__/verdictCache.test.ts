import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { VerdictCache } from "../verdictCache";
import type { Verdict } from "../verdict";

const NEGATIVE: Verdict = {
  is_threat: false,
  threat_type: "none",
  description: "",
  confidence: 0.1,
  boxes: [],
};

const POSITIVE: Verdict = {
  is_threat: true,
  threat_type: "weapon",
  description: "gun",
  confidence: 0.9,
  boxes: [],
};

describe("VerdictCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("hits within TTL for hashes within the Hamming threshold", () => {
    const cache = new VerdictCache({ ttlMs: 30_000, hamming: 5 });
    cache.store("cam-1", "0000000000000000", NEGATIVE);

    // 3 bits differ => within threshold of 5
    expect(cache.lookup("cam-1", "0007000000000000")).toEqual(NEGATIVE);
  });

  it("misses when the Hamming distance exceeds the threshold", () => {
    const cache = new VerdictCache({ ttlMs: 30_000, hamming: 5 });
    cache.store("cam-1", "0000000000000000", NEGATIVE);
    expect(cache.lookup("cam-1", "ffffffffffffffff")).toBeNull();
  });

  it("misses after the TTL", () => {
    const cache = new VerdictCache({ ttlMs: 30_000, hamming: 5 });
    cache.store("cam-1", "0000000000000000", NEGATIVE);
    vi.advanceTimersByTime(30_001);
    expect(cache.lookup("cam-1", "0000000000000000")).toBeNull();
  });

  it("scopes entries per camera", () => {
    const cache = new VerdictCache({ ttlMs: 30_000, hamming: 5 });
    cache.store("cam-1", "0000000000000000", NEGATIVE);
    expect(cache.lookup("cam-2", "0000000000000000")).toBeNull();
  });

  it("never stores or serves positive verdicts", () => {
    const cache = new VerdictCache({ ttlMs: 30_000, hamming: 5 });
    cache.store("cam-1", "0000000000000000", POSITIVE);
    expect(cache.lookup("cam-1", "0000000000000000")).toBeNull();
    // And it does not poison a later negative entry for the same key.
    cache.store("cam-1", "0000000000000000", NEGATIVE);
    expect(cache.lookup("cam-1", "0000000000000000")).toEqual(NEGATIVE);
  });

  it("evicts oldest entries beyond maxEntries", () => {
    const cache = new VerdictCache({ ttlMs: 30_000, hamming: 0, maxEntries: 2 });
    cache.store("cam-1", "0000000000000001", NEGATIVE);
    cache.store("cam-1", "0000000000000002", NEGATIVE);
    cache.store("cam-1", "0000000000000003", NEGATIVE); // evicts the first
    expect(cache.lookup("cam-1", "0000000000000001")).toBeNull();
    expect(cache.lookup("cam-1", "0000000000000003")).toEqual(NEGATIVE);
  });
});
