"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function VideoAnalysisPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pipelineState, setPipelineState] = useState<"idle" | "uploading" | "processing" | "completed">("idle");
  const [progress, setProgress] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleStartAnalysis = () => {
    if (!file) return;

    setPipelineState("uploading");
    setProgress(15);

    // Simulate progress loop
    setTimeout(() => {
      setPipelineState("processing");
      setProgress(45);
      setTimeout(() => {
        setProgress(75);
        setTimeout(() => {
          setPipelineState("completed");
          setProgress(100);
        }, 1500);
      }, 1500);
    }, 1500);
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Video Intelligence Analysis</h2>
          <p className="text-sm text-muted-foreground">
            Upload recorded footage to extract frames, run detection classification, and cache timeline metadata.
          </p>
        </div>
      </div>
      <Separator />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Upload card */}
        <Card>
          <CardHeader>
            <CardTitle>Source Video Upload</CardTitle>
            <CardDescription>Drag and drop or select a local MP4/MKV recording to begin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-primary/50 transition-colors cursor-pointer bg-muted/5 relative">
              <input
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <div className="space-y-2">
                <div className="text-4xl opacity-50">🎬</div>
                {file ? (
                  <div>
                    <p className="text-sm font-semibold">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold">Click to select video</p>
                    <p className="text-xs text-muted-foreground font-light">MP4, WEBM up to 100MB</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            {file && (
              <Button variant="ghost" onClick={() => setFile(null)} className="cursor-pointer">
                Clear
              </Button>
            )}
            <Button
              disabled={!file || pipelineState !== "idle"}
              onClick={handleStartAnalysis}
              className="ml-auto cursor-pointer"
            >
              Start Analysis Pipeline
            </Button>
          </CardFooter>
        </Card>

        {/* Pipeline state tracker */}
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Progress Tracker</CardTitle>
            <CardDescription>Monitoring backend workers and model caching loops.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {pipelineState === "idle" && (
              <p className="text-sm text-muted-foreground text-center py-12">
                No active job. Upload a video and start the pipeline to inspect execution status.
              </p>
            )}

            {pipelineState !== "idle" && (
              <div className="space-y-4">
                <div className="flex justify-between text-xs font-semibold">
                  <span>Inference Progress</span>
                  <span className="font-mono">{progress}%</span>
                </div>
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="space-y-3 pt-4">
                  {/* Step 1: Upload */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">1. File streaming & conversion</span>
                    <Badge variant={progress >= 15 ? "default" : "outline"} className="scale-90">
                      {progress > 15 ? "Done" : progress === 15 ? "Processing" : "Pending"}
                    </Badge>
                  </div>

                  {/* Step 2: Extraction */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">2. Frame extraction (2 FPS sample rate)</span>
                    <Badge variant={progress >= 45 ? "default" : "outline"} className="scale-90">
                      {progress > 45 ? "Done" : progress === 45 ? "Processing" : "Pending"}
                    </Badge>
                  </div>

                  {/* Step 3: Inference */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">3. Local ONNX model detection tags</span>
                    <Badge variant={progress >= 75 ? "default" : "outline"} className="scale-90">
                      {progress > 75 ? "Done" : progress === 75 ? "Processing" : "Pending"}
                    </Badge>
                  </div>

                  {/* Step 4: Summary */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">4. Build temporally-coherent timeline</span>
                    <Badge variant={progress === 100 ? "default" : "outline"} className="scale-90">
                      {progress === 100 ? "Done" : progress >= 75 ? "Processing" : "Pending"}
                    </Badge>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-end border-t border-border/40 pt-4">
            {pipelineState === "completed" && (
              <Link
                href="/analysis/query"
                className={buttonVariants({ variant: "default", className: "cursor-pointer" })}
              >
                Query Footage
              </Link>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
