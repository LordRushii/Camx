import type { WatchProvider, BurstFrame } from "./types.js";

export interface NamedProvider {
  name: string;
  provider: WatchProvider;
}

/**
 * Tries each provider in order; on error (network, rate-limit/429, empty or
 * unparseable response) it falls through to the next. A valid result — even
 * "no harm" — is a success and does NOT trigger fallback. Throws the last
 * error only when every provider in the chain fails.
 */
export class FallbackWatchProvider implements WatchProvider {
  private readonly chain: NamedProvider[];

  constructor(chain: NamedProvider[]) {
    if (chain.length === 0) {
      throw new Error("FallbackWatchProvider requires at least one provider");
    }
    this.chain = chain;
  }

  async analyzeFrame(base64Image: string, mimeType: string) {
    let lastErr: unknown;
    for (const { name, provider } of this.chain) {
      try {
        return await provider.analyzeFrame(base64Image, mimeType);
      } catch (err) {
        lastErr = err;
        console.warn(
          `[WATCH PROVIDER] analyzeFrame failed on "${name}", falling back:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("All watch providers failed on analyzeFrame");
  }

  async analyzeBurst(frames: BurstFrame[], context: string) {
    let lastErr: unknown;
    for (const { name, provider } of this.chain) {
      try {
        return await provider.analyzeBurst(frames, context);
      } catch (err) {
        lastErr = err;
        console.warn(
          `[WATCH PROVIDER] analyzeBurst failed on "${name}", falling back:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("All watch providers failed on analyzeBurst");
  }

  async verifyHarm(base64Image: string, mimeType: string, description: string) {
    let lastErr: unknown;
    for (const { name, provider } of this.chain) {
      try {
        return await provider.verifyHarm(base64Image, mimeType, description);
      } catch (err) {
        lastErr = err;
        console.warn(
          `[WATCH PROVIDER] verifyHarm failed on "${name}", falling back:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("All watch providers failed on verifyHarm");
  }
}
