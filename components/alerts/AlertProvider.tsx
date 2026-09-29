"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

export type AlertSeverity = "critical" | "warning" | "nominal";

export interface ThreatAlert {
  readonly id: string;
  readonly severity: AlertSeverity;
  /** Short one-liner, e.g. "Person with knife detected" */
  readonly title: string;
  /** 1-2 sentence AI/verification detail */
  readonly detail: string;
  readonly cameraId: string;
  readonly cameraLabel: string;
  readonly timestampMs: number;
  readonly source: "live" | "watch";
}

interface AlertContextValue {
  readonly alerts: readonly ThreatAlert[];
  readonly unreadCount: number;
  readonly markAllRead: () => void;
  readonly clearAll: () => void;
  readonly pushAlert: (alert: Omit<ThreatAlert, "id" | "timestampMs" | "source"> & { source?: "live" | "watch" }) => void;
  readonly panelOpen: boolean;
  readonly setPanelOpen: (open: boolean) => void;
  readonly togglePanel: () => void;
}

const AlertContext = createContext<AlertContextValue | null>(null);

const MAX_ALERTS = 50;
/** Re-alert for the same camera+class at most once per this window. */
const DEDUPE_WINDOW_MS = 30_000;
/** How long an on-screen threat toast stays visible. */
const TOAST_DURATION_MS = 10_000;
/** Max toasts stacked on screen at once. */
const MAX_TOASTS = 3;

export function AlertProvider({ children }: { readonly children: React.ReactNode }) {
  const [localAlerts, setLocalAlerts] = useState<ThreatAlert[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  // On-screen toasts — the immediate notification an operator sees without
  // opening the bell/panel. Only warning/critical alerts toast, so routine
  // "frame clear" events stay in the log.
  const [toasts, setToasts] = useState<ThreatAlert[]>([]);
  const lastAlertKeyMs = useRef<Map<string, number>>(new Map());

  // Every alert reaching this surface is a CONFIRMED threat (an LLM verdict or
  // a verified threat log), so nothing here may be filtered out on severity:
  // suppressing "nominal" entries is how a weapon reported at 60% confidence
  // got filed silently and never shown. Severity styles the toast, it does not
  // gate it.
  const enqueueToast = useCallback((alert: ThreatAlert) => {
    setToasts((prev) => [alert, ...prev].slice(0, MAX_TOASTS));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== alert.id));
    }, TOAST_DURATION_MS);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Server-side confirmed threats (watch loop / VLM verification) stream in live
  // via the Convex subscription.
  const activeThreatLogs = useQuery(api.threatLogs.listActive);

  const pushAlert = useCallback<AlertContextValue["pushAlert"]>((alert) => {
    const now = Date.now();
    const dedupeKey = `${alert.cameraId}:${alert.title}`;
    const lastMs = lastAlertKeyMs.current.get(dedupeKey) ?? 0;
    if (now - lastMs < DEDUPE_WINDOW_MS) return; // suppress repeats
    lastAlertKeyMs.current.set(dedupeKey, now);

    const id = `alert-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const full: ThreatAlert = { ...alert, id, timestampMs: now, source: alert.source ?? "live" };
    setLocalAlerts((prev) => [full, ...prev].slice(0, MAX_ALERTS));
    enqueueToast(full);
  }, [enqueueToast]);

  // Convert ACTIVE threat logs (AI-verified threats) into alerts. A ref keeps
  // this idempotent under re-renders, so a log toasts exactly once.
  const knownLogIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeThreatLogs) return;
    for (const log of activeThreatLogs as readonly Doc<"threatLogs">[]) {
      const id = `watch-${log._id}`;
      if (knownLogIdsRef.current.has(id)) continue;
      knownLogIdsRef.current.add(id);
      const ts = Date.parse(log.timestamp);
      // Floor at warning: the log only exists because a threat was detected,
      // so its stored severity may style the alert but never mute it.
      const severity: AlertSeverity = log.severity === "critical" ? "critical" : "warning";
      const full: ThreatAlert = {
        id,
        severity,
        title: log.classification,
        detail: log.previewText,
        cameraId: log.cameraId,
        cameraLabel: log.cameraId,
        timestampMs: Number.isFinite(ts) ? ts : Date.now(),
        source: ((log.tags as readonly string[] | undefined)?.includes("watch") ? "watch" : "live") as ThreatAlert["source"],
      };
      setLocalAlerts((prev) =>
        prev.some((a) => a.id === id) ? prev : [full, ...prev].slice(0, MAX_ALERTS),
      );
      enqueueToast(full);
    }
  }, [activeThreatLogs, enqueueToast]);

  const markAllRead = useCallback(() => {
    setReadIds(new Set(localAlerts.map((a) => a.id)));
  }, [localAlerts]);

  const clearAll = useCallback(() => {
    setLocalAlerts([]);
    setReadIds(new Set());
    setToasts([]);
    lastAlertKeyMs.current.clear();
  }, []);

  const unreadCount = useMemo(
    () => localAlerts.filter((a) => !readIds.has(a.id)).length,
    [localAlerts, readIds],
  );

  const togglePanel = useCallback(() => setPanelOpen((v) => !v), []);

  const value = useMemo<AlertContextValue>(
    () => ({
      alerts: localAlerts,
      unreadCount,
      markAllRead,
      clearAll,
      pushAlert,
      panelOpen,
      setPanelOpen,
      togglePanel,
    }),
    [localAlerts, unreadCount, markAllRead, clearAll, pushAlert, panelOpen, togglePanel],
  );

  return (
    <AlertContext.Provider value={value}>
      {children}
      {/* On-screen threat toasts: the immediate operator notification. */}
      <div className="pointer-events-none fixed top-16 right-4 z-[100] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="alert"
            className={`pointer-events-auto rounded-lg border shadow-lg p-3 backdrop-blur animate-in slide-in-from-top-2 ${
              toast.severity === "critical"
                ? "border-status-critical/60 bg-status-critical text-white"
                : "border-status-warning/60 bg-status-warning text-white"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide">
                  {toast.severity === "critical" ? "⚠ Threat detected" : "Suspicious activity"} — {toast.cameraLabel}
                </p>
                <p className="mt-1 text-xs font-semibold truncate">{toast.title}</p>
                <p className="mt-0.5 text-[11px] opacity-90 line-clamp-3">{toast.detail}</p>
              </div>
              <button
                onClick={() => dismissToast(toast.id)}
                className="shrink-0 rounded px-1.5 text-sm leading-none opacity-80 hover:opacity-100 cursor-pointer"
                aria-label="Dismiss alert"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </AlertContext.Provider>
  );
}

export function useAlerts(): AlertContextValue {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error("useAlerts must be used within <AlertProvider>");
  return ctx;
}

export { severityFromConfidence } from "@/lib/budget/verdict";
