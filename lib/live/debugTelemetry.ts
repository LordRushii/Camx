/**
 * Debug-panel telemetry formatting for the live path.
 *
 * Both the Detect Grid card and the Live Monitor page feed the same
 * CameraDebugPanel, so the verdict-to-telemetry string lives here once instead
 * of being copied into each page. Pure (no DOM, no state) so it is unit-tested
 * and can never drift between the two screens.
 */
/**
 * The subset of a verdict the panel needs. Declared structurally so BOTH the
 * server verdict (`Verdict`, which also carries boxes) and the browser's
 * `AnalyzerVerdict` satisfy it without either being widened or re-declared.
 */
export interface TelemetryVerdict {
  readonly is_threat: boolean;
  readonly threat_type: string;
  readonly description: string;
  readonly confidence: number;
}

/** The shape CameraDebugPanel renders. */
export interface DebugWatchResult {
  readonly isHarm: boolean | null;
  readonly description: string;
}

export interface DebugVerdictMeta {
  /** Who answered the last dispatched frame. */
  readonly provider?: string | null;
  /** True when cloud budgets are spent and LM Studio is answering. */
  readonly degraded?: boolean;
  /** Gate reasons for the last tick, e.g. ["motion", "person", "novel"]. */
  readonly gateReasons?: readonly string[];
}

/**
 * Render the last verdict as debug telemetry, or null when no verdict has
 * arrived yet (the panel shows a blank result rather than a fabricated one).
 */
export function watchResultFromVerdict(
  verdict: TelemetryVerdict | null,
  meta: DebugVerdictMeta = {},
): DebugWatchResult | null {
  if (!verdict) return null;

  if (verdict.is_threat) {
    const confidence = (verdict.confidence * 100).toFixed(0);
    return {
      isHarm: true,
      description: `[${verdict.threat_type}] (conf ${confidence}%) ${verdict.description}`,
    };
  }

  const provider = meta.provider ?? "—";
  const degraded = meta.degraded ? ", degraded" : "";
  const gate = (meta.gateReasons ?? []).join(",") || "closed";
  return { isHarm: false, description: `LLM: no threat (${provider}${degraded}). Gate: ${gate}` };
}
