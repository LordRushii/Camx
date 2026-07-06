"use client";

import { Button } from "@/components/ui/button";

interface CameraControlsProps {
  readonly isCameraActive: boolean;
  readonly isDetectActive: boolean;
  readonly isWatchActive: boolean;
  readonly detectionModel: "rfdetr" | "yolo";
  readonly showWatchDebug: boolean;
  readonly onToggleCamera: () => void;
  readonly onToggleDetect: () => void;
  readonly onToggleWatch: () => void;
  readonly onToggleModel: () => void;
  readonly onToggleDebug: () => void;
}

export function CameraControls({
  isCameraActive,
  isDetectActive,
  isWatchActive,
  detectionModel,
  showWatchDebug,
  onToggleCamera,
  onToggleDetect,
  onToggleWatch,
  onToggleModel,
  onToggleDebug,
}: CameraControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={isCameraActive ? "destructive" : "default"}
        size="sm"
        onClick={onToggleCamera}
        className="cursor-pointer font-semibold text-xs h-8"
      >
        {isCameraActive ? "Stop Camera" : "Start Camera"}
      </Button>

      <Button
        variant={isDetectActive ? "destructive" : "default"}
        size="sm"
        disabled={!isCameraActive}
        onClick={onToggleDetect}
        className="cursor-pointer font-semibold text-xs h-8"
      >
        {isDetectActive ? "Stop Detect" : "Start Detect"}
      </Button>

      <Button
        variant="secondary"
        size="sm"
        disabled={!isCameraActive}
        onClick={onToggleModel}
        className="cursor-pointer font-semibold text-xs h-8"
      >
        Model: {detectionModel === "rfdetr" ? "RF-DETR" : "YOLO"}
      </Button>

      <Button
        variant={isWatchActive ? "destructive" : "default"}
        size="sm"
        disabled={!isCameraActive}
        onClick={onToggleWatch}
        className="cursor-pointer font-semibold text-xs h-8"
      >
        {isWatchActive ? "Stop Watch" : "Start Watch"}
      </Button>

      <Button
        variant={showWatchDebug ? "secondary" : "outline"}
        size="sm"
        disabled={!isCameraActive}
        onClick={onToggleDebug}
        className="cursor-pointer font-semibold text-xs h-8"
      >
        {showWatchDebug ? "Hide Debug" : "Watch Debug"}
      </Button>
    </div>
  );
}
