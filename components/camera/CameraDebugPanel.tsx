"use client";

interface CameraDebugPanelProps {
  readonly latency: number | null;
  readonly requestId: string | null;
  readonly isProcessing: boolean;
  readonly watchResult: { readonly isHarm: boolean | null; readonly description: string } | null;
}

export function CameraDebugPanel({
  latency,
  requestId,
  isProcessing,
  watchResult,
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
          <div className="text-[10px] text-muted-foreground uppercase">Latency</div>
          <div className="font-mono">{latency ? `${latency}ms` : "—"}</div>
        </div>
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
          {JSON.stringify({ requestId, latency, isProcessing, watchResult }, null, 2)}
        </pre>
      </details>
    </div>
  );
}
