"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

interface CameraSettings {
  id: string;
  name: string;
  source: string;
  status: "nominal" | "warning" | "critical";
  isActive: boolean;
}

export default function CameraManagementPage() {
  const [cameras, setCameras] = useState<CameraSettings[]>([
    { id: "cam-1", name: "Front Entry Door", source: "Device 0 (Integrated Camera)", status: "nominal", isActive: true },
    { id: "cam-2", name: "Back Backyard Feed", source: "Device 1 (USB Webcam)", status: "nominal", isActive: true },
    { id: "cam-3", name: "Driveway East", source: "Device 2 (IP Camera Stream)", status: "warning", isActive: false },
    { id: "cam-4", name: "Garage Interior", source: "Local File (test-footage.mp4)", status: "critical", isActive: true },
  ]);

  const [newCameraName, setNewCameraName] = useState("");

  const handleToggle = (id: string) => {
    setCameras((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isActive: !c.isActive } : c))
    );
  };

  const handleAddCamera = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCameraName.trim()) return;

    const newCam: CameraSettings = {
      id: `cam-${Date.now()}`,
      name: newCameraName,
      source: "Simulated Source",
      status: "nominal",
      isActive: true,
    };

    setCameras((prev) => [...prev, newCam]);
    setNewCameraName("");
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Camera Management</h3>
        <p className="text-sm text-muted-foreground">
          Register new camera streams, view active statuses, and toggle grid feeds.
        </p>
      </div>
      <Separator />

      <div className="grid gap-6 md:grid-cols-3">
        {/* Active Cameras List */}
        <div className="md:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Configured Cameras</CardTitle>
              <CardDescription>
                Overview of all connected input cameras on the server.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {cameras.map((camera) => (
                <div
                  key={camera.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-border bg-background hover:bg-muted/10 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{camera.name}</span>
                      <Badge
                        variant="outline"
                        className={
                          camera.status === "nominal"
                            ? "bg-status-nominal/10 text-status-nominal border-status-nominal/30"
                            : camera.status === "warning"
                              ? "bg-status-warning/10 text-status-warning border-status-warning/30"
                              : "bg-status-critical/10 text-status-critical border-status-critical/30"
                        }
                      >
                        {camera.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{camera.source}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={camera.isActive ? "destructive" : "default"}
                      size="sm"
                      onClick={() => handleToggle(camera.id)}
                      className="cursor-pointer"
                    >
                      {camera.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Add Camera Panel */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Register Camera</CardTitle>
              <CardDescription>Configure a new video feed source.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddCamera} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="cam-name" className="text-xs font-semibold text-muted-foreground">
                    Camera Alias Name
                  </label>
                  <Input
                    id="cam-name"
                    placeholder="e.g. Back Garden Entrance"
                    value={newCameraName}
                    onChange={(e) => setNewCameraName(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full cursor-pointer">
                  Add Camera
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
