"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { BellIcon, Delete02Icon } from "@hugeicons/core-free-icons";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAlerts } from "./AlertProvider";

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const severityDot = {
  critical: "bg-status-critical",
  warning: "bg-status-warning",
  nominal: "bg-status-nominal",
} as const;

export function NotificationBell() {
  const pathname = usePathname();
  const { alerts, unreadCount, markAllRead, clearAll, panelOpen, togglePanel } = useAlerts();
  const prevOpenRef = useRef(panelOpen);
  const [hoverOpen, setHoverOpen] = useState(false);

  // Opening the side panel counts as reading too.
  useEffect(() => {
    if (panelOpen && !prevOpenRef.current) markAllRead();
    prevOpenRef.current = panelOpen;
  }, [panelOpen, markAllRead]);

  return (
    <div
      className="relative"
      onMouseEnter={() => setHoverOpen(true)}
      onMouseLeave={() => setHoverOpen(false)}
    >
      <Button
        variant="ghost"
        size="icon"
        className="w-8 h-8 text-muted-foreground hover:text-foreground relative cursor-pointer"
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        onClick={() => {
          togglePanel();
          markAllRead();
        }}
      >
        <HugeiconsIcon icon={BellIcon} className="w-4.5 h-4.5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-status-critical text-[9px] font-bold text-white flex items-center justify-center animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {/* Bell hover dropdown preview (hidden while side panel is open) */}
      {!panelOpen && hoverOpen && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notifications
            </span>
            {alerts.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <HugeiconsIcon icon={Delete02Icon} className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No alerts. All feeds nominal.
              </p>
            ) : (
              alerts.slice(0, 8).map((alert) => (
                <div
                  key={alert.id}
                  className="flex gap-2.5 px-3 py-2.5 border-b border-border/50 last:border-0 hover:bg-muted/40"
                >
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${severityDot[alert.severity]}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">
                      {alert.title}
                      <span className="font-normal text-muted-foreground"> — {alert.cameraLabel}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{alert.detail}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">{timeAgo(alert.timestampMs)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          {pathname !== "/" && (
            <button
              onClick={togglePanel}
              className="w-full px-3 py-2 text-[11px] text-center text-primary hover:bg-muted/40 cursor-pointer border-t border-border"
            >
              Open alert panel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
