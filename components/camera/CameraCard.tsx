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
import { getYoloSession } from "@/lib/detection/onnxSession";
import { detectVideoFrame } from "@/lib/detection/detectFrame";
import type { InferenceSession } from "onnxruntime-web";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAlerts } from "@/components/alerts";
import { useThreatAnalyzer } from "@/hooks/useThreatAnalyzer";
import { Badge } from "@/components/ui/badge";

interface CameraCardProps {
  readonly cameraIndex: number;
  readonly label: string;
  readonly onHarmDetected?: (result: { readonly isHarm: boolean; readonly description: string }, cameraLabel: string) => void;
  readonly cameraId?: string;
  readonly dbId?: Id<"cameras">;
  readonly sourceType?: "device" | "network";
  readonly sourceKey?: string;
  readonly enabled?: boolean;
}

export function CameraCard({
  cameraIndex,
  label,
  onHarmDetected: _onHarmDetected,
  cameraId,
  dbId,
  sourceType,
  sourceKey,
  enabled,
}: CameraCardProps) {
  const deleteCamera = useMutation(api.cameras.remove);
  const { pushAlert } = useAlerts();
  const [isActive, setIsActive] = useState(enabled ?? true);

  // Sync active state when database enabled field changes
  useEffect(() => {
    if (enabled !== undefined) {
      setTimeout(() => setIsActive(enabled), 0);
    }
  }, [enabled]);
  const [isDetectActive, setIsDetectActive] = useState(true);
  const [isWatchActive, setIsWatchActive] = useState(false);
  const [model, setModel] = useState<"rfdetr" | "yolo">("yolo");
  const [showDebug, setShowDebug] = useState(false);
  const [detections, setDetections] = useState<readonly Detection[]>([]);
  // Natural frame dimensions of the last sampled video frame; detections are in
  // this coordinate space so the overlay can scale boxes back correctly.
  const [frameDims, setFrameDims] = useState<{ readonly w: number; readonly h: number }>({ w: 640, h: 480 });
  
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // LLM threat-analysis pipeline (gate → /api/analyze). Runs only while the
  // camera is active; the LLM decides threats, this only spends calls wisely.
  const analyzer = useThreatAnalyzer({
    videoRef,
    enabled: isActive,
    cameraId: cameraId ?? `camera-${cameraIndex}`,
    detections,
  });
  const sessionRef = useRef<InferenceSession | null>(null);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);

  const { devices, isLoading } = useCameraDevices();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("none");

  // Auto-select device based on sourceKey or cameraIndex
  useEffect(() => {
    if (devices.length > 0 && selectedDeviceId === "none") {
      if (sourceType === "device") {
        const deviceIdx = parseInt(sourceKey || "0", 10);
        const dev = devices[deviceIdx] || devices[0];
        if (dev) {
          setTimeout(() => setSelectedDeviceId(dev.deviceId), 0);
        }
      } else if (cameraIndex === 0) {
        const dev = devices[0];
        if (dev) {
          setTimeout(() => setSelectedDeviceId(dev.deviceId), 0);
        }
      }
    }
  }, [devices, cameraIndex, selectedDeviceId, sourceType, sourceKey]);

  // Push an operator alert when the LLM pipeline confirms a threat.
  const lastVerdictKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const v = analyzer.lastVerdict;
    if (!v || !v.is_threat) return;
    const key = `${analyzer.phase}:${v.threat_type}:${v.description}`;
    if (lastVerdictKeyRef.current === key) return;
    lastVerdictKeyRef.current = key;
    pushAlert({
      severity: v.confidence >= 0.9 ? "critical" : v.confidence >= 0.75 ? "warning" : "nominal",
      title: `AI threat: ${v.threat_type}`,
      detail: v.description,
      cameraId: cameraId ?? `camera-${cameraIndex}`,
      cameraLabel: label,
      source: "live",
    });
  }, [analyzer.lastVerdict, analyzer.phase, cameraId, cameraIndex, label, pushAlert]);


  // In-browser YOLO11n inference loop (onnxruntime-web, WebGPU with WASM fallback).
  useEffect(() => {
    if (!isActive || !isDetectActive) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const tick = async () => {
      const videoEl = videoRef.current;
      // Skip until the video has real dimensions to sample.
      if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
        if (active) timeoutId = setTimeout(tick, 100);
        return;
      }

      try {
        // Lazily initialize the singleton session on first ready frame.
        if (!sessionRef.current) {
          sessionRef.current = await getYoloSession();
          if (!active) return;
        }

        setIsProcessing(true);
        const { detections: dets, latencyMs } = await detectVideoFrame(
          videoEl,
          sessionRef.current,
        );

        if (active) {
          setDetections(dets);
          setFrameDims({ w: videoEl.videoWidth, h: videoEl.videoHeight });
          setLastLatency(latencyMs);
          setLastRequestId(`local-${cameraIndex}-${Date.now()}`);
        }
      } catch (err) {
        console.warn(`[CameraCard] Local inference error:`, err);
        if (active) {
          setDetectError(
            err instanceof Error ? err.message : "Unknown inference error",
          );
        }
      } finally {
        if (active) {
          setIsProcessing(false);
          // Run loop at ~5 FPS
          timeoutId = setTimeout(tick, 200);
        }
      }
    };

    tick();

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isActive, isDetectActive, cameraIndex]);

  // Threats are declared only by the cloud vision LLM (analyzer), never by
  // local COCO YOLO — its knife class is unreliable and there is no firearm
  // class. Local detections drive the gate + object list, not alerts; the
  // AI-verified Convex stream (AlertProvider) raises global alerts.
  const status = !isActive
    ? "inactive"
    : analyzer.phase === "threat" || analyzer.lastVerdict?.is_threat
      ? "critical"
      : "nominal";

  return (
    <Card className="overflow-hidden border border-border shadow bg-card text-card-foreground">
      <CardHeader className="flex flex-col gap-2 pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-sm font-semibold">{label}</CardTitle>
            <div className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">
              {cameraId ? `ID: ${cameraId}` : `Index: ${cameraIndex}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {analyzer.phase === "backoff" && (
              <Badge variant="outline" className="text-xxs px-1 py-0 bg-status-warning/10 text-status-warning border-status-warning/30">
                budget backoff
              </Badge>
            )}
            {analyzer.phase === "analyzing" && (
              <Badge variant="outline" className="text-xxs px-1 py-0 bg-status-nominal/10 text-status-nominal border-status-nominal/30">
                analyzing…
              </Badge>
            )}
            {analyzer.phase === "threat" && (
              <Badge variant="outline" className="text-xxs px-1 py-0 bg-status-critical/10 text-status-critical border-status-critical/30">
                AI THREAT
              </Badge>
            )}
            <CameraStatusBadge status={status} />
            {dbId && (
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  if (confirm(`Are you sure you want to delete camera "${label}"?`)) {
                    try {
                      await deleteCamera({ id: dbId });
                    } catch (err) {
                      console.error("Failed to delete camera:", err);
                    }
                  }
                }}
                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                title="Delete Camera"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
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
          <CameraOverlay
            cameraId={cameraId || `camera-${cameraIndex}`}
            isDetectActive={isDetectActive}
            model="yolo"
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
            setDetectError(null);
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

