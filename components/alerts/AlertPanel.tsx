"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Delete02Icon, LeftToRightListBulletIcon } from "@hugeicons/core-free-icons";
import { useAlerts } from "./AlertProvider";

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const severityStyles = {
  critical: {
    dot: "bg-status-critical",
    border: "border-l-status-critical",
    badge: "bg-status-critical/10 text-status-critical border-status-critical/30",
  },
  warning: {
    dot: "bg-status-warning",
    border: "border-l-status-warning",
    badge: "bg-status-warning/10 text-status-warning border-status-warning/30",
  },
  nominal: {
    dot: "bg-status-nominal",
    border: "border-l-status-nominal",
    badge: "bg-status-nominal/10 text-status-nominal border-status-nominal/30",
  },
} as const;

const sourceLabel = {
  live: "LIVE",
  watch: "AI",
} as const;

export function AlertPanel() {
  const { alerts, clearAll, panelOpen, setPanelOpen } = useAlerts();
  const [now, setNow] = useState(() => Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (panelOpen) {
      intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [panelOpen]);

  return (
    <aside
      className={`shrink-0 overflow-hidden border-l border-border bg-card transition-all duration-200 ${
        panelOpen ? "w-72" : "w-0 border-l-0"
      }`}
      aria-hidden={!panelOpen}
    >
      <div className="flex h-full w-72 flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <HugeiconsIcon icon={LeftToRightListBulletIcon} className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wider">Alerts</span>
            {alerts.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">
                {alerts.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {alerts.length > 0 && (
              <button
                onClick={clearAll}
                title="Clear all"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <HugeiconsIcon icon={Delete02Icon} className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setPanelOpen(false)}
              title="Close panel"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {alerts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
              <p className="text-xs font-medium text-muted-foreground">No active alerts</p>
              <p className="text-[11px] text-muted-foreground/70">
                Threat detections from live feeds and the AI watch loop will appear here.
              </p>
            </div>
          ) : (
            alerts.map((alert) => {
              const style = severityStyles[alert.severity];
              const ageSec = Math.max(0, Math.floor((now - alert.timestampMs) / 1000));
              const age =
                ageSec < 60 ? `${ageSec}s ago` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago` : `${Math.floor(ageSec / 3600)}h ago`;
              return (
                <article
                  key={alert.id}
                  className={`border-b border-border/50 border-l-2 ${style.border} px-3 py-2.5`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${style.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                      {alert.severity}
                      <span className="font-medium text-muted-foreground">· {sourceLabel[alert.source]}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground" title={formatTime(alert.timestampMs)}>
                      {age}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs font-semibold leading-snug">{alert.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {alert.detail}
                  </p>
                  <p className="mt-1 text-[10px] font-medium text-muted-foreground/80">
                    {alert.cameraLabel} · {formatTime(alert.timestampMs)}
                  </p>
                </article>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
