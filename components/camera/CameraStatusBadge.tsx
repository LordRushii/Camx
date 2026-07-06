"use client";

import { Badge } from "@/components/ui/badge";

export type CameraStatus = "nominal" | "warning" | "critical" | "inactive";

interface CameraStatusBadgeProps {
  readonly status: CameraStatus;
}

export function CameraStatusBadge({ status }: CameraStatusBadgeProps) {
  const statusStyles = {
    nominal: "bg-status-nominal/10 text-status-nominal border-status-nominal/30",
    warning: "bg-status-warning/10 text-status-warning border-status-warning/30",
    critical: "bg-status-critical/10 text-status-critical border-status-critical/30",
    inactive: "bg-muted text-muted-foreground border-border",
  };

  const labels = {
    nominal: "Nominal",
    warning: "Warning",
    critical: "Alert",
    inactive: "Offline",
  };

  return (
    <Badge variant="outline" className={`capitalize font-semibold text-xs py-0.5 px-2.5 ${statusStyles[status]}`}>
      {labels[status]}
    </Badge>
  );
}
