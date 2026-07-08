"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CameraFeed, CameraOverlay, CameraStatusBadge, CameraControls, CameraDebugPanel } from "@/components/camera";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCameraDevices } from "@/hooks/useCameraDevices";
import { Button } from "@/components/ui/button";
import { Trash2, Camera } from "lucide-react";

interface LiveAlert {
  id: string;
  time: string;
  camera: string;
  message: string;
  type: "nominal" | "warning" | "critical";
}

interface MockDetection {
  bbox: [number, number, number, number];
  class: string;
  confidence: number;
}

export default function LiveMonitorPage() {
  const cameras = useQuery(api.cameras.list);
  const deleteCamera = useMutation(api.cameras.remove);
  const { devices } = useCameraDevices();
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
  const [alerts, setAlerts] = useState<LiveAlert[]>([
    { id: "a1", time: "22:45:12", camera: "Camera 1", message: "Knife threat unverified", type: "warning" },
    { id: "a2", time: "22:45:13", camera: "Camera 1", message: "VLM verification process initiated", type: "nominal" },
    { id: "a3", time: "22:45:15", camera: "Camera 1", message: "Threat confirmed: Weapon visible", type: "critical" },
  ]);

  // Feed active state
  const [isFeedActive, setIsFeedActive] = useState(true);
  const [isDetectActive, setIsDetectActive] = useState(true);
  const [isWatchActive, setIsWatchActive] = useState(true);
  const [model, setModel] = useState<"rfdetr" | "yolo">("rfdetr");
  const [showDebug, setShowDebug] = useState(false);

  // Dynamic mock detections that drift/move over time
  const [detections, setDetections] = useState<MockDetection[]>([]);

  useEffect(() => {
    if (!isFeedActive || !isDetectActive) {
      setTimeout(() => setDetections([]), 0);
      return;
    }

    const interval = setInterval(() => {
      // Randomly simulate 1 to 2 moving objects
      const time = Date.now() * 0.001;
      const count = Math.sin(time * 0.5) > 0 ? 2 : 1;
      const list: MockDetection[] = [];

      // Object 1: Person walking across
      const x1 = 150 + Math.sin(time) * 100;
      const y1 = 100 + Math.cos(time * 0.8) * 30;
      list.push({
        bbox: [x1, y1, x1 + 120, y1 + 250],
        class: "person",
        confidence: 0.85 + Math.sin(time * 2) * 0.05,
      });

      // Object 2: Backpack or phone
      if (count > 1) {
        const x2 = 380 + Math.cos(time * 1.2) * 40;
        const y2 = 200 + Math.sin(time * 1.5) * 30;
        list.push({
          bbox: [x2, y2, x2 + 80, y2 + 100],
          class: "backpack",
          confidence: 0.72 + Math.cos(time) * 0.07,
        });
      }

      setDetections(list);
    }, 100);

    return () => clearInterval(interval);
  }, [isFeedActive, isDetectActive]);

  // Append logs periodically
  useEffect(() => {
    const logInterval = setInterval(() => {
      const msgs = [
        { msg: "Intrusion boundary warning triggered", type: "warning" as const },
        { msg: "WebGPU frame extraction nominal", type: "nominal" as const },
        { msg: "Model caching garbage collected", type: "nominal" as const },
        { msg: "VLM verification: Safe/filtered outcome", type: "nominal" as const },
      ];
      const randomMsg = msgs[Math.floor(Math.random() * msgs.length)];
      const now = new Date().toTimeString().split(" ")[0];

      setAlerts((prev) => [
        {
          id: String(Date.now()),
          time: now,
          camera: selectedCam === "camera-1" ? "Camera 1" : "Camera 2",
          message: randomMsg.msg,
          type: randomMsg.type,
        },
        ...prev.slice(0, 15),
      ]);
    }, 4500);

    return () => clearInterval(logInterval);
  }, [selectedCam]);

  const activeStatus = alerts[0]?.type ?? "nominal";

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Live Monitor Desk</h2>
          <p className="text-sm text-muted-foreground">
            Consolidated operator panel with active canvas overlays, alarm badges, and VLM telemetry logs.
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
                    const currentCam = cameras?.find((c) => c.cameraId === selectedCam);
                    if (!currentCam) return null;
                    return (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          if (confirm(`Are you sure you want to delete camera "${currentCam.name}"?`)) {
                            try {
                              await deleteCamera({ id: currentCam._id });
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
                (() => {
                  const currentCam = cameras?.find((c) => c.cameraId === selectedCam);
                  const sourceType = currentCam?.sourceType;
                  const sourceKey = currentCam?.sourceKey;

                  let deviceId: string | undefined = undefined;
                  if (sourceType === "device" && devices && devices.length > 0) {
                    const deviceIndex = parseInt(sourceKey || "0", 10);
                    const dev = devices[deviceIndex] || devices[0];
                    deviceId = dev?.deviceId;
                  }

                  return (
                    <div className="w-full max-w-[640px] aspect-[4/3] relative overflow-hidden my-6 border border-border/20 rounded-md">
                      {/* Camera Feed component */}
                      <CameraFeed isCameraActive={isFeedActive} label={currentCam?.name || "Live Entrance Feed"} deviceId={deviceId} />

                      {/* Canvas Overlay for detections */}
                      {isFeedActive && isDetectActive && (
                        <CameraOverlay cameraId={selectedCam} isDetectActive={isDetectActive} model={model} width={640} height={480} />
                      )}
                    </div>
                  );
                })()
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
                onToggleModel={() => setModel((m) => (m === "rfdetr" ? "yolo" : "rfdetr"))}
                onToggleDebug={() => setShowDebug(!showDebug)}
              />

              {showDebug && isFeedActive && (
                <div className="w-full">
                  <CameraDebugPanel
                    latency={45}
                    requestId="req-monitor-889"
                    isProcessing={false}
                    watchResult={
                      isWatchActive
                        ? { isHarm: activeStatus === "critical", description: alerts[0]?.message ?? "No active threats." }
                        : null
                    }
                  />
                </div>
              )}
            </CardFooter>
          </Card>
        </div>

        {/* Right 1 col: Intelligence log */}
        <div className="space-y-4">
          {/* Active object list */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Active Detections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {detections.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active objects in frame.</p>
              ) : (
                detections.map((d, index) => (
                  <div key={index} className="flex justify-between items-center text-xs p-2 rounded bg-muted/20 border border-border/30">
                    <span className="font-semibold capitalize text-foreground">{d.class}</span>
                    <span className="font-mono text-muted-foreground">{(d.confidence * 100).toFixed(0)}% conf</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Scrolling log */}
          <Card className="h-[400px] flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Intel Stream Log</CardTitle>
              <CardDescription className="text-xxs">Real-time telemetry event warnings.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto px-4 space-y-3 pb-6">
              {alerts.map((alert) => (
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
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
