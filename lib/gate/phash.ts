/**
 * Perceptual-hash scene-novelty gate (Layer 1c) — 05-DETECTION-AND-PROMPTS.md §3.3.
 *
 * 64-bit dHash (difference hash): 9×8 grayscale resize, compare adjacent
 * columns. Cheap, robust to lighting/JPEG noise. Pure buffer math (no DOM)
 * so it is unit-testable; the caller provides the ImageData.
 *
 * Hash representation: 16-char hex string; distance via two 32-bit halves
 * (ES2017-safe, no BigInt).
 */

const DHASH_W = 9;
const DHASH_H = 8;

/** Downscale RGBA to 9×8 grayscale via box sampling. */
function grayscale9x8(rgba: Uint8ClampedArray, w: number, h: number): Float64Array {
  const out = new Float64Array(DHASH_W * DHASH_H);
  for (let ty = 0; ty < DHASH_H; ty++) {
    const sy = Math.min(h - 1, Math.floor(((ty + 0.5) / DHASH_H) * h));
    for (let tx = 0; tx < DHASH_W; tx++) {
      const sx = Math.min(w - 1, Math.floor(((tx + 0.5) / DHASH_W) * w));
      const i = (sy * w + sx) * 4;
      out[ty * DHASH_W + tx] = (rgba[i]! * 299 + rgba[i + 1]! * 587 + rgba[i + 2]! * 114) / 1000;
    }
  }
  return out;
}

/**
 * Compute the 64-bit dHash of an RGBA frame. Each of the 8×8 column pairs
 * yields one bit: 1 when the left pixel is brighter than the right.
 */
export function dHashFromRgba(rgba: Uint8ClampedArray, w: number, h: number): string {
  const gray = grayscale9x8(rgba, w, h);
  let hi = 0; // bits 63..32
  let lo = 0; // bits 31..0
  let bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = gray[y * 9 + x]!;
      const right = gray[y * 9 + x + 1]!;
      if (left > right) {
        if (bit < 32) lo |= 1 << bit;
        else hi |= 1 << (bit - 32);
      }
      bit++;
    }
  }
  // 8 hex chars each, zero-padded.
  const hiHex = (hi >>> 0).toString(16).padStart(8, "0");
  const loHex = (lo >>> 0).toString(16).padStart(8, "0");
  return hiHex + loHex;
}

export interface Uint64Parts {
  readonly hi: number;
  readonly lo: number;
}

export function hexToUint64Parts(hex: string): Uint64Parts {
  const h = hex.length === 16 ? hex : hex.padStart(16, "0").slice(-16);
  return { hi: parseInt(h.slice(0, 8), 16) >>> 0, lo: parseInt(h.slice(8), 16) >>> 0 };
}

function popcount32(x: number): number {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

/** Hamming distance between two 64-bit hashes held as 32-bit halves. */
export function hammingParts(a: { hi: number; lo: number }, b: { hi: number; lo: number }): number {
  return popcount32(a.hi ^ b.hi) + popcount32(a.lo ^ b.lo);
}

/** Hamming distance between two 16-char hex hashes. */
export function hammingHex(a: string, b: string): number {
  return hammingParts(hexToUint64Parts(a), hexToUint64Parts(b));
}
