import { describe, expect, it } from "vitest";
import { computeMotionScore, grayscaleThumb } from "../motion";

// ---------------------------------------------------------------------------
// grayscaleThumb + computeMotionScore operate on raw RGBA buffers, so the
// tests need no DOM — just Uint8ClampedArray fixtures.
// ---------------------------------------------------------------------------

function solidRgba(w: number, h: number, v: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = v;
    buf[i * 4 + 1] = v;
    buf[i * 4 + 2] = v;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

function shiftedRgba(w: number, h: number, base: number, delta: number): Uint8ClampedArray {
  const buf = solidRgba(w, h, base);
  // Brighten the left half => a clear, uniform change.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w / 2; x++) {
      const i = (y * w + x) * 4;
      buf[i] = base + delta;
      buf[i + 1] = base + delta;
      buf[i + 2] = base + delta;
    }
  }
  return buf;
}

describe("grayscaleThumb", () => {
  it("defaults to a 32x32 grayscale thumbnail", () => {
    const thumb = grayscaleThumb(solidRgba(8, 8, 128), 8, 8);
    expect(thumb).toHaveLength(32 * 32);
    expect(thumb.every((v) => v === 128)).toBe(true);
  });

  it("respects an explicit thumbnail size", () => {
    const thumb = grayscaleThumb(solidRgba(8, 8, 128), 8, 8, 8);
    expect(thumb).toHaveLength(64);
    expect(thumb.every((v) => v === 128)).toBe(true);
  });

  it("downsamples a larger buffer to the requested size", () => {
    const thumb = grayscaleThumb(solidRgba(64, 64, 200), 64, 64, 8);
    expect(thumb).toHaveLength(64); // 8x8
    expect(thumb.every((v) => v === 200)).toBe(true);
  });
});

describe("computeMotionScore", () => {
  it("returns 0 for identical frames", () => {
    const a = grayscaleThumb(solidRgba(8, 8, 100), 8, 8);
    const b = grayscaleThumb(solidRgba(8, 8, 100), 8, 8);
    expect(computeMotionScore(a, b)).toBe(0);
  });

  it("returns a positive score for differing frames", () => {
    const a = grayscaleThumb(solidRgba(8, 8, 50), 8, 8);
    const b = grayscaleThumb(solidRgba(8, 8, 150), 8, 8);
    const score = computeMotionScore(a, b);
    expect(score).toBeGreaterThan(0);
    // 100/255 diff on every pixel => ~0.39
    expect(score).toBeCloseTo(100 / 255, 1);
  });

  it("scores the half-shifted frame at roughly half the full diff", () => {
    const prev = grayscaleThumb(solidRgba(32, 32, 100), 32, 32);
    const half = grayscaleThumb(shiftedRgba(32, 32, 100, 100), 32, 32);
    const full = grayscaleThumb(solidRgba(32, 32, 200), 32, 32);
    const halfScore = computeMotionScore(prev, half);
    const fullScore = computeMotionScore(prev, full);
    expect(halfScore).toBeGreaterThan(0);
    expect(halfScore).toBeLessThan(fullScore);
  });

  it("handles mismatched lengths defensively (returns 0, never throws)", () => {
    const a = new Uint8ClampedArray(64);
    const b = new Uint8ClampedArray(32);
    expect(computeMotionScore(a, b)).toBe(0);
  });
});
