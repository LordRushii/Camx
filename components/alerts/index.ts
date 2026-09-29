export { AlertProvider, useAlerts } from "./AlertProvider";
// Severity vocabulary lives with the verdict domain (single source of truth);
// `severityFromConfidence` is the stored-log tiering, `threatAlertSeverity` the
// displayed tiering for a confirmed threat.
export { severityFromConfidence, threatAlertSeverity } from "@/lib/budget/verdict";
export { NotificationBell } from "./NotificationBell";
export { AlertPanel } from "./AlertPanel";
