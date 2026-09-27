import type { WatchProvider } from "./types.js";
import { GeminiProvider } from "./GeminiProvider.js";
import { GroqProvider } from "./GroqProvider.js";
import { NvidiaProvider } from "./NvidiaProvider.js";
import { LmStudioProvider } from "./LmStudioProvider.js";
import { FallbackWatchProvider, type NamedProvider } from "./FallbackWatchProvider.js";

export type WatchProviderName = "gemini" | "groq" | "nvidia" | "lmstudio";

// NVIDIA's free credits are LIFETIME (03 §2), so it sits before lmstudio but
// after the daily-quota providers — spent only when they fail.
const DEFAULT_ORDER: WatchProviderName[] = ["gemini", "groq", "nvidia", "lmstudio"];

function tryBuild(name: WatchProviderName): NamedProvider | null {
  try {
    switch (name) {
      case "gemini":
        return { name, provider: new GeminiProvider() };
      case "groq":
        return { name, provider: new GroqProvider() };
      case "nvidia":
        return { name, provider: new NvidiaProvider() };
      case "lmstudio":
        return { name, provider: new LmStudioProvider() };
    }
  } catch (err) {
    console.warn(
      `[WATCH PROVIDER] Skipping "${name}" — not configured:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Build the active watch provider from env `WATCH_PROVIDER` (default "gemini"),
 * wrapped in a fallback chain: <selected> -> remaining defaults, ending in
 * LM Studio. Providers whose API keys are missing are skipped; LM Studio is the
 * offline fallback and never throws at construction, so the chain is never empty.
 */
export function createWatchProvider(): WatchProvider {
  const selected = (process.env.WATCH_PROVIDER || "gemini")
    .trim()
    .toLowerCase() as WatchProviderName;

  const order: WatchProviderName[] = DEFAULT_ORDER.includes(selected)
    ? [selected, ...DEFAULT_ORDER.filter((n) => n !== selected)]
    : [...DEFAULT_ORDER];

  const chain = order
    .map(tryBuild)
    .filter((p): p is NamedProvider => p !== null);

  if (chain.length === 0) {
    console.warn(
      "[WATCH PROVIDER] No providers configured; using LM Studio only."
    );
    return new LmStudioProvider();
  }

  console.log(
    `[WATCH PROVIDER] Active watch chain: ${chain.map((c) => c.name).join(" -> ")}`
  );
  return new FallbackWatchProvider(chain);
}
