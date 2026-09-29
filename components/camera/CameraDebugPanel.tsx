"use client";

import type { DebugWatchResult } from "@/lib/live/debugTelemetry";

interface CameraDebugPanelProps {
  /** Round-trip ms of the last /api/analyze dispatch — the LLM call itself. */
  readonly latency: number | null;
  /** Request id of that same dispatch, as sent to the server. */
  readonly requestId: string | null;
  /**
   * Local YOLO inference time. Kept as its own row on purpose: it is a
   * different measurement from the LLM round-trip, and showing it under the
   * "Latency" heading (as this panel used to) hid real pipeline failures behind
   * a healthy-looking 70ms number.
   */
  readonly yoloLatency?: number | null;
  readonly isProcessing: boolean;
  readonly watchResult: DebugWatchResult | null;
  /** Last LLM/gate pipeline error, when there is one (shown instead of nothing). */
  readonly error?: string | null;
  /** Which provider answered the last dispatched frame. */
  readonly provider?: string | null;
}

export function CameraDebugPanel({
  latency,
  requestId,
  yoloLatency = null,
  isProcessing,
  watchResult,
  error = null,
  provider = null,
}: CameraDebugPanelProps) {
  const isHarm = watchResult?.isHarm ?? null;

  return (
    <div className="mt-4 p-4 rounded-lg border border-border bg-card text-card-foreground text-xs space-y-3 shadow-md">
      <div className="flex items-center justify-between">
        <span className="font-bold text-muted-foreground uppercase tracking-wider text-[10px]">
          Watch Verification Telemetry
        </span>
        {isProcessing && (
          <span className="text-primary animate-pulse text-[10px]">Processing...</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded bg-muted/30 border border-border/40">
          <div className="text-[10px] text-muted-foreground uppercase">Request ID</div>
          <div className="font-mono truncate">{requestId ?? "—"}</div>
        </div>

        <div className="p-2 rounded bg-muted/30 border border-border/40">
          <div className="text-[10px] text-muted-foreground uppercase">LLM latency</div>
          <div className="font-mono">{latency === null ? "—" : `${latency}ms`}</div>
        </div>

        {yoloLatency !== null && (
          <div className="p-2 rounded bg-muted/30 border border-border/40">
            <div className="text-[10px] text-muted-foreground uppercase">YOLO latency</div>
            <div className="font-mono text-muted-foreground">
              {yoloLatency === null ? "—" : `${Math.round(yoloLatency)}ms`}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-2 rounded bg-status-critical/10 border border-status-critical/40 text-status-critical font-mono text-[10px] break-words">
          LLM pipeline error: {error}
        </div>
      )}

      <div className="p-2 rounded bg-muted/30 border border-border/40">
        <div className="text-[10px] text-muted-foreground uppercase">Provider</div>
        <div className="font-mono">{provider ?? "—"}</div>
      </div>

      <div className="p-3 rounded bg-muted/40 border border-border/60">
        <div className="text-[10px] text-muted-foreground uppercase mb-1">Inference Result</div>
        <div className="space-y-1">
          <div>
            <span className="text-muted-foreground font-semibold">isHarm:</span>{" "}
            <span className={isHarm === true ? "text-status-critical font-bold" : isHarm === false ? "text-status-nominal font-bold" : "text-muted-foreground"}>
              {isHarm === null ? "null" : String(isHarm)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground font-semibold">Description:</span>{" "}
            <span>{watchResult?.description ?? "—"}</span>
          </div>
        </div>
      </div>

      <details className="p-2 rounded bg-muted/20 border border-border/30 overflow-hidden cursor-pointer select-none">
        <summary className="font-bold text-[10px] text-muted-foreground uppercase outline-none hover:text-foreground transition-colors">
          Raw verifier feedback
        </summary>
        <pre className="mt-2 p-2 rounded bg-black text-status-nominal font-mono text-[9px] overflow-x-auto max-h-32 whitespace-pre-wrap leading-relaxed">
          {JSON.stringify({ requestId, latency, yoloLatency, isProcessing, watchResult, error, provider }, null, 2)}
        </pre>
      </details>
    </div>
  );
}
