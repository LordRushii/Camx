"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CameraFeed, CameraOverlay, CameraStatusBadge, CameraControls, CameraDebugPanel } from "@/components/camera";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCameraDevices } from "@/hooks/useCameraDevices";
import { useLiveDetection, detectionSeverity } from "@/hooks/useLiveDetection";
import { cocoClassName } from "@/lib/coco";
import { useAlerts } from "@/components/alerts";
import { Button } from "@/components/ui/button";
import { Trash2, Camera } from "lucide-react";
import { useThreatAnalyzer } from "@/hooks/useThreatAnalyzer";
import { UsageMeter } from "@/components/monitor/UsageMeter";

type EventType = "nominal" | "warning" | "critical";

interface LiveAlert {
  id: string;
  time: string;
  camera: string;
  message: string;
  detail: string;
  type: EventType;
}

export default function LiveMonitorPage() {
  const cameras = useQuery(api.cameras.list);
  const deleteCamera = useMutation(api.cameras.remove);
  const activeThreatLogs = useQuery(api.threatLogs.listActive);
  const { devices } = useCameraDevices();
  const { pushAlert } = useAlerts();
  const [selectedCam, setSelectedCam] = useState<string | null>(null);

  // Synchronize selected camera selection
  useEffect(() => {
    if (!cameras) return;
    if (cameras.length > 0) {
      const exists = cameras.some((c) => c.cameraId === selectedCam);
      if (!exists || !selectedCam) {
        setTimeout(() => setSelectedCam(cameras[0].cameraId), 0);
      }
    } else if (selectedCam !== null) {
      setTimeout(() => setSelectedCam(null), 0);
    }
  }, [cameras, selectedCam]);

  // Feed active state
  const [isFeedActive, setIsFeedActive] = useState(true);
  const [isDetectActive, setIsDetectActive] = useState(true);
  const [isWatchActive, setIsWatchActive] = useState(false);
  const [model] = useState<"rfdetr" | "yolo">("yolo");
  const [showDebug, setShowDebug] = useState(false);

  const currentCam = cameras?.find((c) => c.cameraId === selectedCam);

  // Device resolution for the selected camera
  let deviceId: string | undefined = undefined;
  if (currentCam?.sourceType === "device" && devices.length > 0) {
    const deviceIndex = parseInt(currentCam.sourceKey || "0", 10);
    const dev = devices[deviceIndex] || devices[0];
    deviceId = dev?.deviceId;
  }

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Real in-browser YOLO inference loop — same pipeline as the Detect Grid.
  const {
    detections,
    frameDims,
    latencyMs,
    fps,
    error: detectError,
  } = useLiveDetection({
    videoRef,
    enabled: isFeedActive && isDetectActive && deviceId !== undefined,
  });

  // Live LLM analysis pipeline (gate → /api/analyze) with budget telemetry.
  const analyzer = useThreatAnalyzer({
    videoRef,
    enabled: isFeedActive && deviceId !== undefined,
    cameraId: selectedCam ?? "monitor",
    detections,
  });

  // Real event log, assembled from genuine sources:
  //  1. Live detections from the local YOLO loop (this page)
  //  2. AI-verified threat logs streamed from Convex (watch loop / VLM)
  //  3. Real telemetry events (session init, inference errors)
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);

  const appendAlert = useCallback((alert: Omit<LiveAlert, "id" | "time">) => {
    const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const time = new Date().toLocaleTimeString([], { hour12: false });
    setAlerts((prev) => [{ ...alert, id, time }, ...prev].slice(0, 30));
  }, []);

  // Log every change in the live detection set as a real event.
  const loggedDetectionsRef = useRef<string>("");
  useEffect(() => {
    if (!isFeedActive || !isDetectActive) return;
    const signature = detections
      .map((d) => {
        const name = typeof d.class === "number" ? cocoClassName(d.class, "yolo") : d.class;
        return `${name}:${Math.round(d.confidence * 100)}`;
      })
      .sort()
      .join("|");

    if (signature === loggedDetectionsRef.current) return;

    if (detections.length === 0 && loggedDetectionsRef.current !== "") {
      loggedDetectionsRef.current = "";
      appendAlert({
        camera: currentCam?.name ?? selectedCam ?? "Feed",
        message: "Frame clear — no objects detected",
        detail: "Local YOLO11n inference found no objects above the confidence threshold.",
        type: "nominal",
      });
      return;
    }

    for (const d of detections) {
      const name = typeof d.class === "number" ? cocoClassName(d.class, "yolo") : d.class;
      const severity = detectionSeverity(d);
      const conf = Math.round(d.confidence * 100);
      appendAlert({
        camera: currentCam?.name ?? selectedCam ?? "Feed",
        message:
          severity === "critical"
            ? `THREAT: ${name} detected (${conf}% conf)`
            : severity === "warning"
              ? `Suspicious object: ${name} (${conf}% conf)`
              : `Detected ${name} (${conf}% conf)`,
        detail: `Local YOLO11n inference @ ${fps ? fps.toFixed(1) : "—"} FPS, ${latencyMs?.toFixed(0) ?? "—"}ms latency.`,
        type: severity,
      });
      if (severity === "critical") {
        pushAlert({
          severity: "critical",
          title: `${name.charAt(0).toUpperCase() + name.slice(1)} detected`,
          detail: `Live Monitor flagged a ${name} (${conf}% confidence) on ${currentCam?.name ?? selectedCam}.`,
          cameraId: selectedCam ?? "monitor",
          cameraLabel: currentCam?.name ?? "Live Monitor",
          source: "live",
        });
      }
    }
    loggedDetectionsRef.current = signature;
  }, [detections, isFeedActive, isDetectActive, currentCam?.name, selectedCam, fps, latencyMs, appendAlert, pushAlert]);

  // AI-verified threats from the Convex watch loop appear as real events too.
  const loggedThreatIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeThreatLogs) return;
    for (const log of activeThreatLogs) {
      if (loggedThreatIdsRef.current.has(log._id)) continue;
      loggedThreatIdsRef.current.add(log._id);
      appendAlert({
        camera: log.cameraId,
        message: `AI VERIFIED: ${log.classification}`,
        detail: log.previewText,
        type: log.severity === "critical" ? "critical" : log.severity === "warning" ? "warning" : "nominal",
      });
    }
  }, [activeThreatLogs, appendAlert]);

  const activeStatus: EventType = (() => {
    const worst = alerts[0]?.type ?? "nominal";
    if (detections.some((d) => detectionSeverity(d) === "critical")) return "critical";
    if (detections.some((d) => detectionSeverity(d) === "warning")) return "warning";
    return worst;
  })();

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Live Monitor Desk</h2>
          <p className="text-sm text-muted-foreground">
            Consolidated operator panel with active canvas overlays, alarm badges, and live inference telemetry.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-semibold">Overall Desk Alert:</span>
          <CameraStatusBadge status={activeStatus} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Left 3 cols: Camera viewport */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="space-y-1">
                <CardTitle className="text-base font-semibold">Primary Feed Monitor</CardTitle>
                <CardDescription>Targeting main terminal gateway entrance.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedCam || ""}
                  onValueChange={(val) => {
                    if (val) setSelectedCam(val);
                  }}
                >
                  <SelectTrigger className="w-[180px] text-xs font-semibold">
                    <SelectValue placeholder="Select camera" />
                  </SelectTrigger>
                  <SelectContent>
                    {cameras === undefined ? (
                      <SelectItem value="loading">Loading cameras...</SelectItem>
                    ) : cameras.length === 0 ? (
                      <SelectItem value="none">No cameras registered</SelectItem>
                    ) : (
                      cameras.map((camera) => (
                        <SelectItem key={camera._id} value={camera.cameraId} className="text-xs font-semibold">
                          {camera.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>

                {/* Delete selected camera button */}
                {selectedCam && selectedCam !== "loading" && selectedCam !== "none" && (
                  (() => {
                    const cam = cameras?.find((c) => c.cameraId === selectedCam);
                    if (!cam) return null;
                    return (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          if (confirm(`Are you sure you want to delete camera "${cam.name}"?`)) {
                            try {
                              await deleteCamera({ id: cam._id });
                              setSelectedCam(null); // Clear selection so useEffect auto-selects next one
                            } catch (err) {
                              console.error("Failed to delete camera:", err);
                            }
                          }
                        }}
                        className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer border border-border/40"
                        title="Delete Selected Camera"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    );
                  })()
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 border-t border-border flex flex-col items-center bg-black relative">
              {selectedCam ? (
                <div className="w-full max-w-[640px] aspect-[4/3] relative overflow-hidden my-6 border border-border/20 rounded-md">
                  {/* Camera Feed component */}
                  <CameraFeed isCameraActive={isFeedActive} label={currentCam?.name || "Live Entrance Feed"} deviceId={deviceId} videoRef={videoRef} />

                  {/* Canvas Overlay for real detections */}
                  {isFeedActive && isDetectActive && (
                    <CameraOverlay
                      cameraId={selectedCam}
                      isDetectActive={isDetectActive}
                      model={model}
                      width={640}
                      height={480}
                      detections={detections}
                      frameWidth={frameDims.w}
                      frameHeight={frameDims.h}
                    />
                  )}

                  {detectError && (
                    <div className="absolute top-2 left-2 right-2 z-10 rounded bg-status-critical/90 px-2 py-1 text-[10px] font-semibold text-white shadow">
                      Detection error: {detectError}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center aspect-[4/3] w-full max-w-[640px] my-6 border border-dashed border-border/40 rounded-md bg-muted/5 p-6 text-center">
                  <Camera className="w-8 h-8 text-muted-foreground/50 mb-3" />
                  <p className="text-sm font-semibold text-muted-foreground">No active feed</p>
                  <p className="text-xs text-muted-foreground font-light mt-1">
                    Select a camera from the dropdown above, or register a new input device in settings.
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-4 p-6 bg-muted/10 border-t border-border">
              <CameraControls
                isCameraActive={isFeedActive}
                isDetectActive={isDetectActive}
                isWatchActive={isWatchActive}
                detectionModel={model}
                showWatchDebug={showDebug}
                onToggleCamera={() => setIsFeedActive(!isFeedActive)}
                onToggleDetect={() => setIsDetectActive(!isDetectActive)}
                onToggleWatch={() => setIsWatchActive(!isWatchActive)}
                onToggleModel={() => undefined}
                onToggleDebug={() => setShowDebug(!showDebug)}
              />

              {showDebug && (
                <CameraDebugPanel
                  latency={latencyMs}
                  requestId={deviceId ? `local-${selectedCam}` : null}
                  isProcessing={false}
                  watchResult={
                    isWatchActive
                      ? {
                          isHarm: activeStatus === "critical" ? true : activeStatus === "warning" ? false : null,
                          description:
                            activeStatus === "critical"
                              ? "Local YOLO flagged a threat-class object in the current frame."
                              : activeStatus === "warning"
                                ? "Local YOLO flagged a suspicious object in the current frame."
                                : "Nominal surveillance state. No verified threats.",
                        }
                      : null
                  }
                />
              )}
            </CardFooter>
          </Card>
        </div>

        {/* Right 1 col: Intelligence log */}
        <div className="space-y-4">
          {/* Live budget meter (Phase 4) */}
          <UsageMeter
            budget={analyzer.budget}
            provider={analyzer.provider}
            phase={analyzer.phase}
            degraded={analyzer.degraded}
            lastGateReasons={analyzer.lastGateReasons}
          />

          {/* Active object list — real detections */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Active Detections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(!isFeedActive || !isDetectActive || detections.length === 0) ? (
                <p className="text-xs text-muted-foreground">No active objects in frame.</p>
              ) : (
                detections.map((d, index) => {
                  const name = typeof d.class === "number" ? cocoClassName(d.class, "yolo") : d.class;
                  return (
                    <div key={index} className="flex justify-between items-center text-xs p-2 rounded bg-muted/20 border border-border/30">
                      <span className="font-semibold capitalize text-foreground">{name}</span>
                      <span className="font-mono text-muted-foreground">{(d.confidence * 100).toFixed(0)}% conf</span>
                    </div>
                  );
                })
              )}
              {isFeedActive && isDetectActive && latencyMs !== null && (
                <div className="flex justify-between items-center text-[10px] p-2 rounded bg-muted/10 border border-border/20 text-muted-foreground">
                  <span className="font-mono">YOLO11n · WebGPU</span>
                  <span className="font-mono">{latencyMs.toFixed(0)}ms · {fps ? `${fps.toFixed(1)} FPS` : "—"}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Scrolling log — real events */}
          <Card className="h-[400px] flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Intel Stream Log</CardTitle>
              <CardDescription className="text-xxs">Live detections, AI verifications, and telemetry.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto px-4 space-y-3 pb-6">
              {alerts.length === 0 ? (
                <p className="text-xxs text-muted-foreground py-4 text-center">
                  No events yet. Events appear when detections change or AI threats are verified.
                </p>
              ) : (
                alerts.map((alert) => (
                  <div key={alert.id} className="text-xxs space-y-1 p-2 rounded-md border border-border/40 bg-muted/5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-muted-foreground">{alert.time}</span>
                      <Badge
                        variant="outline"
                        className={`text-xxs scale-90 px-1 py-0 ${
                          alert.type === "critical"
                            ? "bg-status-critical/10 text-status-critical border-status-critical/30"
                            : alert.type === "warning"
                              ? "bg-status-warning/10 text-status-warning border-status-warning/30"
                              : "bg-status-nominal/10 text-status-nominal border-status-nominal/30"
                        }`}
                      >
                        {alert.type}
                      </Badge>
                    </div>
                    <p className="font-medium text-foreground">{alert.message}</p>
                    <p className="text-muted-foreground leading-snug">{alert.detail}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
