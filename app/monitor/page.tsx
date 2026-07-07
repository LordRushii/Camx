"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CameraFeed, CameraOverlay, CameraStatusBadge, CameraControls, CameraDebugPanel } from "@/components/camera";

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
  const [selectedCam, setSelectedCam] = useState("camera-1");
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
              <Select value={selectedCam} onValueChange={(val) => { if (val) setSelectedCam(val); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="camera-1">Camera 1 (Front Entrance)</SelectItem>
                  <SelectItem value="camera-2">Camera 2 (Loading Dock)</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0 border-t border-border flex flex-col items-center bg-black relative">
              <div className="w-full max-w-[640px] aspect-[4/3] relative overflow-hidden my-6 border border-border/20 rounded-md">
                {/* Camera Feed component */}
                <CameraFeed isCameraActive={isFeedActive} label="Live Entrance Feed" />

                {/* Canvas Overlay for detections */}
                {isFeedActive && isDetectActive && (
                  <CameraOverlay cameraId={selectedCam} isDetectActive={isDetectActive} model={model} width={640} height={480} />
                )}
              </div>
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
