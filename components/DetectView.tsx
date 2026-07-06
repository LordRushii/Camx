"use client";

import { useState } from "react";
import { CameraCard } from "@/components/camera/CameraCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function DetectView() {
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{
    readonly cameraLabel: string;
    readonly description: string;
  } | null>(null);

  const handleHarmDetected = (
    result: { readonly isHarm: boolean; readonly description: string },
    cameraLabel: string
  ) => {
    // Only show if alert is not already open
    if (!alertOpen) {
      setAlertInfo({ cameraLabel, description: result.description });
      setAlertOpen(true);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 p-6 w-full max-w-7xl mx-auto">
      {/* Overview stats header */}
      <div className="w-full flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/20 border border-border/40 rounded-lg p-5">
        <div>
          <h1 className="font-heading text-xl font-bold tracking-tight">Active Surveillance Grid</h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-light">
            Real-time feed classification overlay using WebGPU local execution.
          </p>
        </div>
        <div className="flex gap-4">
          <div className="text-center">
            <span className="block text-lg font-bold">4</span>
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">Feeds</span>
          </div>
          <div className="border-r border-border" />
          <div className="text-center">
            <span className="block text-lg font-bold text-status-nominal">3</span>
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">Active</span>
          </div>
          <div className="border-r border-border" />
          <div className="text-center">
            <span className="block text-lg font-bold text-status-critical">0</span>
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">Threats</span>
          </div>
        </div>
      </div>

      {/* Grid of 4 cameras */}
      <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
        <CameraCard
          cameraIndex={0}
          label="Entrance Gate A"
          onHarmDetected={handleHarmDetected}
        />
        <CameraCard
          cameraIndex={1}
          label="Server Hall Corridor"
          onHarmDetected={handleHarmDetected}
        />
        <CameraCard
          cameraIndex={2}
          label="Back Storage Loading Dock"
          onHarmDetected={handleHarmDetected}
        />
        <CameraCard
          cameraIndex={3}
          label="Front Reception Lobby"
          onHarmDetected={handleHarmDetected}
        />
      </div>

      {/* Threat Alert Dialog */}
      <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
        <DialogContent className="sm:max-w-md border-status-critical bg-card">
          <DialogHeader className="space-y-3">
            <div className="w-12 h-12 rounded-full bg-status-critical/10 flex items-center justify-center text-status-critical text-2xl mx-auto animate-bounce">
              ⚠️
            </div>
            <DialogTitle className="text-center text-status-critical font-bold text-lg">
              CRITICAL HARM VERIFIED
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-muted-foreground">
              A second-pass VLM check has verified a potential threat signature.
            </DialogDescription>
          </DialogHeader>

          {alertInfo && (
            <div className="p-4 rounded-lg bg-muted/40 border border-border/40 text-xs space-y-2">
              <div>
                <span className="font-semibold text-muted-foreground">Source Camera:</span>{" "}
                <span className="font-bold text-foreground">{alertInfo.cameraLabel}</span>
              </div>
              <div>
                <span className="font-semibold text-muted-foreground">Detection:</span>{" "}
                <span>{alertInfo.description}</span>
              </div>
            </div>
          )}

          <DialogFooter className="flex sm:justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => setAlertOpen(false)}
              className="w-full sm:w-auto cursor-pointer"
            >
              Mute Alarm
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setAlertOpen(false);
                window.location.href = "/settings/threat-log";
              }}
              className="w-full sm:w-auto cursor-pointer"
            >
              View Threat Log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
