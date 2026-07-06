"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CameraFeed } from "./CameraFeed";
import { CameraOverlay, Detection } from "./CameraOverlay";
import { CameraControls } from "./CameraControls";
import { CameraStatusBadge } from "./CameraStatusBadge";
import { CameraDebugPanel } from "./CameraDebugPanel";
import { useCameraDevices } from "@/hooks/useCameraDevices";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CameraCardProps {
  readonly cameraIndex: number;
  readonly label: string;
  readonly onHarmDetected?: (result: { readonly isHarm: boolean; readonly description: string }, cameraLabel: string) => void;
}

export function CameraCard({ cameraIndex, label }: CameraCardProps) {
  const [isActive, setIsActive] = useState(true);
  const [isDetectActive, setIsDetectActive] = useState(true);
  const [isWatchActive, setIsWatchActive] = useState(false);
  const [model, setModel] = useState<"rfdetr" | "yolo">("rfdetr");
  const [showDebug, setShowDebug] = useState(false);
  const [detections, setDetections] = useState<readonly Detection[]>([]);
  
  const { devices, isLoading } = useCameraDevices();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("none");

  // Auto-select first device only for index 0 (webcam 1), others default to none
  useEffect(() => {
    if (devices.length > 0 && selectedDeviceId === "none" && cameraIndex === 0) {
      const dev = devices[0];
      if (dev) {
        setTimeout(() => setSelectedDeviceId(dev.deviceId), 0);
      }
    }
  }, [devices, cameraIndex, selectedDeviceId]);

  // Simulate sliding bounding boxes for this camera index when active
  useEffect(() => {
    if (!isActive || !isDetectActive) {
      setTimeout(() => setDetections([]), 0);
      return;
    }

    const interval = setInterval(() => {
      const time = Date.now() * 0.001 + cameraIndex * 15;
      const list: Detection[] = [];

      // Object 1: drifting person box
      const x1 = 120 + Math.sin(time * 0.7) * 70;
      const y1 = 150 + Math.cos(time * 0.5) * 20;
      list.push({
        bbox: [x1, y1, x1 + 100, y1 + 220],
        class: "person",
        confidence: 0.88 + Math.sin(time) * 0.04,
      });

      // Object 2: phone or suspicious object
      if (Math.sin(time * 0.3) > 0.1) {
        const x2 = x1 + 40;
        const y2 = y1 + 80;
        list.push({
          bbox: [x2, y2, x2 + 30, y2 + 40],
          class: "cell phone",
          confidence: 0.65 + Math.cos(time) * 0.05,
        });
      }

      setDetections(list);
    }, 120);

    return () => clearInterval(interval);
  }, [isActive, isDetectActive, cameraIndex]);

  // Determine status color based on detections
  const hasThreat = detections.some((d) => ["weapon", "knife", "handgun", "rifle"].includes(d.class.toLowerCase()));
  const hasWarning = detections.some((d) => ["backpack", "cell phone"].includes(d.class.toLowerCase()));
  
  const status = !isActive
    ? "inactive"
    : hasThreat
      ? "critical"
      : hasWarning
        ? "warning"
        : "nominal";

  return (
    <Card className="overflow-hidden border border-border shadow bg-card text-card-foreground">
      <CardHeader className="flex flex-col gap-2 pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-sm font-semibold">{label}</CardTitle>
            <div className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">
              Index: {cameraIndex}
            </div>
          </div>
          <CameraStatusBadge status={status} />
        </div>

        {/* Camera Selector Dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground font-semibold shrink-0">Camera Source:</span>
          <Select
            value={selectedDeviceId}
            onValueChange={(val) => { if (val) setSelectedDeviceId(val); }}
          >
            <SelectTrigger className="h-7 text-xs flex-1 bg-muted/30">
              <SelectValue placeholder="Loading camera sources..." />
            </SelectTrigger>
            <SelectContent>
              {isLoading ? (
                <SelectItem value="none">Loading devices...</SelectItem>
              ) : (
                <>
                  <SelectItem value="none">Diagnostic Feed (None)</SelectItem>
                  {devices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      
      <CardContent className="p-0 border-t border-border flex flex-col items-center bg-black relative aspect-[4/3] overflow-hidden">
        <CameraFeed isCameraActive={isActive} label={label} deviceId={selectedDeviceId} />
        {isActive && isDetectActive && (
          <CameraOverlay detections={detections} width={640} height={480} />
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-3 p-4 bg-muted/10 border-t border-border">
        <CameraControls
          isCameraActive={isActive}
          isDetectActive={isDetectActive}
          isWatchActive={isWatchActive}
          detectionModel={model}
          showWatchDebug={showDebug}
          onToggleCamera={() => {
            setIsActive(!isActive);
            if (isActive) {
              setIsDetectActive(false);
              setIsWatchActive(false);
            } else {
              setIsDetectActive(true);
            }
          }}
          onToggleDetect={() => setIsDetectActive(!isDetectActive)}
          onToggleWatch={() => setIsWatchActive(!isWatchActive)}
          onToggleModel={() => setModel((m) => (m === "rfdetr" ? "yolo" : "rfdetr"))}
          onToggleDebug={() => setShowDebug(!showDebug)}
        />

        {showDebug && isActive && (
          <div className="w-full">
            <CameraDebugPanel
              latency={35 + (cameraIndex * 5)}
              requestId={`req-telemetry-${cameraIndex}-8894`}
              isProcessing={false}
              watchResult={
                isWatchActive
                  ? {
                      isHarm: status === "critical",
                      description: status === "critical"
                        ? "VLM second-pass confirmed weapon presence in frame."
                        : "Nominal surveillance state. No verified threats."
                    }
                  : null
              }
            />
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
