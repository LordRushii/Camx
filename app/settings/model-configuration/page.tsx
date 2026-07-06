"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export default function ModelConfigurationPage() {
  const [model, setModel] = useState("rfdetr");
  const [confThreshold, setConfThreshold] = useState(50);
  const [iouThreshold, setIouThreshold] = useState(45);
  const [harmThreshold, setHarmThreshold] = useState(70);

  const handleSave = () => {
    alert("Model configuration settings saved successfully!");
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Model Configuration</h3>
        <p className="text-sm text-muted-foreground">
          Tune the local ONNX inference models and threshold parameters.
        </p>
      </div>
      <Separator />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Inference Model Settings</CardTitle>
            <CardDescription>
              Select which object detection model should run on WebGPU.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="model-select" className="text-sm font-medium">
                Primary Detector Model
              </label>
              <Select value={model} onValueChange={(val) => { if (val) setModel(val); }}>
                <SelectTrigger id="model-select" className="w-[280px]">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rfdetr">RF-DETR Segmentation (Nano)</SelectItem>
                  <SelectItem value="yolo">YOLOv11x Object Detection</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                RF-DETR provides segmentation masks; YOLOv11x provides higher box accuracy.
              </p>
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="text-sm font-medium">Inference Thresholds</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Confidence Threshold */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Detection Confidence</span>
                    <span className="text-xs text-muted-foreground">{confThreshold}%</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={confThreshold}
                    onChange={(e) => setConfThreshold(Number(e.target.value))}
                    className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <p className="text-xxs text-muted-foreground">
                    Minimum confidence for object boundary boxes.
                  </p>
                </div>

                {/* IOU Threshold */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Intersection Over Union (IOU)</span>
                    <span className="text-xs text-muted-foreground">{iouThreshold}%</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={iouThreshold}
                    onChange={(e) => setIouThreshold(Number(e.target.value))}
                    className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <p className="text-xxs text-muted-foreground">
                    IOU threshold used by Non-Maximum Suppression (NMS).
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Harm watch threshold */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Watch Verification Threshold</span>
                <span className="text-xs font-mono text-muted-foreground">{harmThreshold}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                value={harmThreshold}
                onChange={(e) => setHarmThreshold(Number(e.target.value))}
                className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <p className="text-xs text-muted-foreground font-light">
                Alert trigger threshold for VLM verification passes.
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button onClick={handleSave} className="cursor-pointer">Save Changes</Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
