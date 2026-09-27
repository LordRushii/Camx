/**
 * Verdict cache for the live /api/analyze route (03 §7).
 *
 * Keyed by cameraId + 64-bit perceptual hash. If an incoming frame's hash is
 * within the Hamming threshold of a cached scene, the cached NEGATIVE verdict
 * is reused and the LLM call is skipped entirely (0 cost).
 *
 * Never caches positive verdicts: a threat must never be silenced by a cache
 * hit, and verify-on-positive must always re-run.
 */
import type { Verdict } from "./verdict";
import { hexToUint64Parts, hammingParts, type Uint64Parts } from "../gate/phash";
import { envIntOrZero } from "../shared/env";

export interface VerdictCacheOptions {
  /** Cache TTL in ms (env WATCH_VERDICT_TTL_MS, default 30_000). */
  readonly ttlMs?: number;
  /** Same-scene Hamming threshold of 64 bits (env WATCH_PHASH_HAMMING, default 5). */
  readonly hamming?: number;
  /** Max cached scenes (per cache) before oldest-eviction. */
  readonly maxEntries?: number;
}

interface Entry {
  readonly hash: Uint64Parts;
  readonly verdict: Verdict;
  readonly expiresAt: number;
}

// Hamming helpers live in lib/gate/phash.ts (single source; the popcount32
// implementation) — re-exported here for budget-layer callers.
export { hexToUint64Parts, hammingParts };

export class VerdictCache {
  private readonly ttlMs: number;
  private readonly hamming: number;
  private readonly maxEntries: number;
  private readonly byCamera = new Map<string, Entry[]>();

  constructor(options: VerdictCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? envIntOrZero("WATCH_VERDICT_TTL_MS", 30_000);
    this.hamming = options.hamming ?? envIntOrZero("WATCH_PHASH_HAMMING", 5);
    this.maxEntries = options.maxEntries ?? 200;
  }

  lookup(cameraId: string, hexHash: string): Verdict | null {
    const entries = this.byCamera.get(cameraId);
    if (!entries || entries.length === 0) return null;
    const now = Date.now();
    const hash = hexToUint64Parts(hexHash);

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      if (entry.expiresAt <= now) {
        entries.splice(i, 1);
        continue;
      }
      if (hammingParts(hash, entry.hash) <= this.hamming) {
        return entry.verdict;
      }
    }
    return null;
  }

  store(cameraId: string, hexHash: string, verdict: Verdict): void {
    // Positive verdicts are never cached (03 §7).
    if (verdict.is_threat) return;

    const entries = this.byCamera.get(cameraId) ?? [];
    entries.push({ hash: hexToUint64Parts(hexHash), verdict, expiresAt: Date.now() + this.ttlMs });
    while (entries.length > this.maxEntries) {
      entries.shift();
    }
    this.byCamera.set(cameraId, entries);
  }

  clear(): void {
    this.byCamera.clear();
  }
}

// --- Process-wide singleton -------------------------------------------------

const GLOBAL_KEY = "__camx2_verdict_cache__";

/** Shared server-side cache instance (hot-reload safe). */
export const verdictCache: VerdictCache = (() => {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: VerdictCache };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new VerdictCache();
  }
  return g[GLOBAL_KEY];
})();
