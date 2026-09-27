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

function severityFromConfidence(confidence: number): AlertSeverity {
  if (confidence >= 0.9) return "critical";
  if (confidence >= 0.75) return "warning";
  return "nominal";
}

export function AlertProvider({ children }: { readonly children: React.ReactNode }) {
  const [localAlerts, setLocalAlerts] = useState<ThreatAlert[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const lastAlertKeyMs = useRef<Map<string, number>>(new Map());

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
    setLocalAlerts((prev) => [
      { ...alert, id, timestampMs: now, source: alert.source ?? "live" },
      ...prev,
    ].slice(0, MAX_ALERTS));
  }, []);

  // Convert ACTIVE threat logs (AI-verified threats) into alerts.
  useEffect(() => {
    if (!activeThreatLogs) return;
    for (const log of activeThreatLogs as readonly Doc<"threatLogs">[]) {
      const ts = Date.parse(log.timestamp);
      const id = `watch-${log._id}`;
      const severity: AlertSeverity = log.severity === "critical" ? "critical" : log.severity === "warning" ? "warning" : "nominal";
      setLocalAlerts((prev) => {
        if (prev.some((a) => a.id === id)) return prev;
        return [
          {
            id,
            severity,
            title: log.classification,
            detail: log.previewText,
            cameraId: log.cameraId,
            cameraLabel: log.cameraId,
            timestampMs: Number.isFinite(ts) ? ts : Date.now(),
            source: ((log.tags as readonly string[] | undefined)?.includes("watch") ? "watch" : "live") as ThreatAlert["source"],
          },
          ...prev,
        ].slice(0, MAX_ALERTS);
      });
    }
  }, [activeThreatLogs]);

  const markAllRead = useCallback(() => {
    setReadIds(new Set(localAlerts.map((a) => a.id)));
  }, [localAlerts]);

  const clearAll = useCallback(() => {
    setLocalAlerts([]);
    setReadIds(new Set());
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

  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
}

export function useAlerts(): AlertContextValue {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error("useAlerts must be used within <AlertProvider>");
  return ctx;
}

export { severityFromConfidence };
