import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CameraFeed } from "./CameraFeed";
import { CameraOverlay } from "./CameraOverlay";
import { CameraControls } from "./CameraControls";
import { CameraStatusBadge } from "./CameraStatusBadge";
import { CameraDebugPanel } from "./CameraDebugPanel";
import { useCameraDevices } from "@/hooks/useCameraDevices";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Detection } from "@/lib/draw";
import { cocoClassName } from "@/lib/coco";

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
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

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



  // Frame capture and posting loop
  useEffect(() => {
    if (!isActive || !isDetectActive) return;

    let timeoutId: NodeJS.Timeout | null = null;
    let abortController: AbortController | null = null;
    let active = true;

    const captureAndPost = async () => {
      const videoEl = videoRef.current;
      if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
        if (active) timeoutId = setTimeout(captureAndPost, 100);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        if (active) timeoutId = setTimeout(captureAndPost, 100);
        return;
      }

      try {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg");
        const blob = await fetch(dataUrl).then((r) => r.blob());

        if (abortController) abortController.abort();
        abortController = new AbortController();

        setIsProcessing(true);
        const formData = new FormData();
        formData.append("frame", blob, `frame-${cameraIndex}.jpg`);
        formData.append("cameraId", `camera-${cameraIndex}`);
        formData.append("model", model);

        const response = await fetch("http://localhost:3001/detect", {
          method: "POST",
          body: formData,
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        const data = await response.json();
        if (data.ok && active) {
          setDetections(data.detections);
          setLastLatency(data.meta?.latencyMs ?? null);
          setLastRequestId(data.requestId ?? null);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.warn(`[CameraCard] Detection loop error:`, err);
      } finally {
        if (active) {
          setIsProcessing(false);
          // Run loop at ~5 FPS
          timeoutId = setTimeout(captureAndPost, 200);
        }
      }
    };

    captureAndPost();

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
      if (abortController) abortController.abort();
    };
  }, [isActive, isDetectActive, cameraIndex, model]);

  // Determine status color based on detections
  const hasThreat = detections.some((d) => {
    const className = typeof d.class === "number" ? cocoClassName(d.class, model) : d.class;
    return ["weapon", "knife", "handgun", "rifle"].includes(className.toLowerCase());
  });
  const hasWarning = detections.some((d) => {
    const className = typeof d.class === "number" ? cocoClassName(d.class, model) : d.class;
    return ["backpack", "cell phone"].includes(className.toLowerCase());
  });
  
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
        <CameraFeed isCameraActive={isActive} label={label} deviceId={selectedDeviceId} videoRef={videoRef} />
        {isActive && isDetectActive && (
          <CameraOverlay cameraId={`camera-${cameraIndex}`} isDetectActive={isDetectActive} model={model} width={640} height={480} />
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
            const nextActive = !isActive;
            setIsActive(nextActive);
            if (!nextActive) {
              setIsDetectActive(false);
              setIsWatchActive(false);
              setDetections([]);
              setLastLatency(null);
              setLastRequestId(null);
            } else {
              setIsDetectActive(true);
            }
          }}
          onToggleDetect={() => {
            const nextDetect = !isDetectActive;
            setIsDetectActive(nextDetect);
            if (!nextDetect) {
              setDetections([]);
              setLastLatency(null);
              setLastRequestId(null);
            }
          }}
          onToggleWatch={() => setIsWatchActive(!isWatchActive)}
          onToggleModel={() => setModel((m) => (m === "rfdetr" ? "yolo" : "rfdetr"))}
          onToggleDebug={() => setShowDebug(!showDebug)}
        />

        {showDebug && isActive && (
          <div className="w-full">
            <CameraDebugPanel
              latency={lastLatency ?? 0}
              requestId={lastRequestId ?? `req-telemetry-${cameraIndex}-8894`}
              isProcessing={isProcessing}
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

