import { describe, expect, it } from "vitest";
import { dHashFromRgba, hammingHex, hexToUint64Parts, hammingParts } from "../phash";

function gradientRgba(w: number, h: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.floor((x / w) * 255);
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

describe("dHashFromRgba", () => {
  it("returns a 16-char hex string (64 bits)", () => {
    const hash = dHashFromRgba(gradientRgba(64, 64), 64, 64);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for identical inputs", () => {
    const buf = gradientRgba(64, 64);
    expect(dHashFromRgba(buf, 64, 64)).toBe(dHashFromRgba(buf, 64, 64));
  });

  it("produces close hashes for slightly-shifted images", () => {
    const a = gradientRgba(64, 64);
    const b = gradientRgba(64, 64);
    // Shift content 2px right.
    for (let y = 0; y < 64; y++) {
      for (let x = 63; x > 1; x--) {
        const dst = (y * 64 + x) * 4;
        const src = (y * 64 + x - 2) * 4;
        b[dst] = a[src]!;
        b[dst + 1] = a[src + 1]!;
        b[dst + 2] = a[src + 2]!;
      }
    }
    const ha = dHashFromRgba(a, 64, 64);
    const hb = dHashFromRgba(b, 64, 64);
    expect(hammingHex(ha, hb)).toBeLessThanOrEqual(10);
  });

  it("produces distant hashes for very different images", () => {
    const a = gradientRgba(64, 64); // smooth horizontal gradient
    // Deterministic pseudo-random noise: ~50% of dHash bits differ.
    const b = new Uint8ClampedArray(64 * 64 * 4);
    let seed = 42;
    for (let i = 0; i < 64 * 64; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = (seed >>> 16) & 255;
      b[i * 4] = v;
      b[i * 4 + 1] = v;
      b[i * 4 + 2] = v;
      b[i * 4 + 3] = 255;
    }
    const ha = dHashFromRgba(a, 64, 64);
    const hb = dHashFromRgba(b, 64, 64);
    expect(hammingHex(ha, hb)).toBeGreaterThan(10);
  });
});

describe("hamming helpers", () => {
  it("reports 0 for identical hashes", () => {
    expect(hammingHex("0123456789abcdef", "0123456789abcdef")).toBe(0);
  });

  it("counts flipped bits", () => {
    expect(hammingHex("0000000000000000", "0000000000000001")).toBe(1);
    expect(hammingHex("0000000000000000", "0000000000000007")).toBe(3);
    expect(hammingHex("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  it("splits hex into 32-bit halves consistently", () => {
    const { hi, lo } = hexToUint64Parts("0000000100000002");
    expect(hi).toBe(1);
    expect(lo).toBe(2);
    expect(hammingParts(hexToUint64Parts("0000000100000002"), hexToUint64Parts("0000000100000002"))).toBe(0);
    expect(hammingParts(hexToUint64Parts("0000000100000002"), hexToUint64Parts("0000000200000003"))).toBe(3);
  });
});
