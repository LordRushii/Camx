"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

export default function DeploymentProfilePage() {
  const [memoryLimit, setMemoryLimit] = useState(2048);

  const handleSave = () => {
    alert("Deployment profile settings saved!");
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Deployment Profile</h3>
        <p className="text-sm text-muted-foreground">
          Manage system-level profiles, ONNX execution backends, and memory consumption guidelines.
        </p>
      </div>
      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>System Performance Profile</CardTitle>
          <CardDescription>
            Audit execution metrics and limit the system resources allocated to local model processes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Hardware Target */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-sm font-medium block">Active Execution Provider</span>
              <span className="text-xs text-muted-foreground font-light">
                Hardware acceleration layer used by ONNX Runtime.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-status-nominal/10 text-status-nominal border-status-nominal/30">
                WebGPU Enabled
              </Badge>
              <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
                CPU Fallback OK
              </Badge>
            </div>
          </div>

          <Separator />

          {/* Memory limit slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Model RAM Limit</span>
              <span className="text-xs font-mono text-muted-foreground">{memoryLimit} MB</span>
            </div>
            <input
              type="range"
              min="512"
              max="4096"
              step="256"
              value={memoryLimit}
              onChange={(e) => setMemoryLimit(Number(e.target.value))}
              className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <p className="text-xs text-muted-foreground">
              Maximum RAM allocated to model compilation and frame extraction before garbage collection triggers.
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button onClick={handleSave} className="cursor-pointer">
            Save Profile
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
