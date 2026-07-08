"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
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
  const latestActiveThreat = useQuery(api.threatLogs.latestActive);
  const cameras = useQuery(api.cameras.list);
  const updateStatus = useMutation(api.threatLogs.updateStatus);

  const activeCamera = cameras?.find((c) => c.cameraId === latestActiveThreat?.cameraId);
  const cameraLabel = activeCamera ? activeCamera.name : (latestActiveThreat?.cameraId ?? "");

  const handleMuteAlarm = async () => {
    if (latestActiveThreat) {
      await updateStatus({
        ids: [latestActiveThreat._id],
        status: "ACKNOWLEDGED",
      });
    }
  };

  const totalFeeds = cameras?.length ?? 0;
  const activeFeeds = cameras?.filter((c) => c.enabled).length ?? 0;
  const activeThreatsCount = latestActiveThreat ? 1 : 0;

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
            <span className="block text-lg font-bold">{totalFeeds}</span>
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">Feeds</span>
          </div>
          <div className="border-r border-border" />
          <div className="text-center">
            <span className="block text-lg font-bold text-status-nominal">{activeFeeds}</span>
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">Active</span>
          </div>
          <div className="border-r border-border" />
          <div className="text-center">
            <span className="block text-lg font-bold text-status-critical">{activeThreatsCount}</span>
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">Threats</span>
          </div>
        </div>
      </div>

      {/* Dynamic Grid of cameras */}
      <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
        {cameras === undefined ? (
          <div className="col-span-full flex justify-center items-center h-32">
            <span className="text-xs text-muted-foreground font-medium animate-pulse">
              Syncing hardware feeds...
            </span>
          </div>
        ) : cameras.length > 0 ? (
          cameras.map((camera, index) => (
            <CameraCard
              key={camera._id}
              cameraIndex={index}
              label={camera.name}
              cameraId={camera.cameraId}
              dbId={camera._id}
              sourceType={camera.sourceType}
              sourceKey={camera.sourceKey}
              enabled={camera.enabled}
            />
          ))
        ) : (
          <div className="col-span-full flex flex-col items-center justify-center p-8 border border-dashed border-border/40 rounded-xl bg-muted/5 text-center h-48">
            <p className="text-sm font-semibold text-muted-foreground">No cameras registered</p>
            <p className="text-xs text-muted-foreground font-light mt-1">
              Add camera inputs on the Camera Management settings page to start surveillance monitoring.
            </p>
          </div>
        )}
      </div>

      {/* Threat Alert Dialog */}
      <Dialog open={!!latestActiveThreat} onOpenChange={(open) => { if (!open) void handleMuteAlarm(); }}>
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

          {latestActiveThreat && (
            <div className="p-4 rounded-lg bg-muted/40 border border-border/40 text-xs space-y-2">
              <div>
                <span className="font-semibold text-muted-foreground">Source Camera:</span>{" "}
                <span className="font-bold text-foreground">{cameraLabel}</span>
              </div>
              <div>
                <span className="font-semibold text-muted-foreground">Detection:</span>{" "}
                <span>{latestActiveThreat.previewText}</span>
              </div>
            </div>
          )}

          <DialogFooter className="flex sm:justify-center gap-2">
            <Button
              variant="outline"
              onClick={handleMuteAlarm}
              className="w-full sm:w-auto cursor-pointer"
            >
              Mute Alarm
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleMuteAlarm();
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
