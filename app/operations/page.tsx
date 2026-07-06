"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function OperationsDeskPage() {
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Operations Desk</h2>
          <p className="text-sm text-muted-foreground">
            Monitor real-time server workloads, database health, and camera stream statistics.
          </p>
        </div>
        <Badge variant="outline" className="bg-status-nominal/10 text-status-nominal border-status-nominal/30">
          Global System Nominal
        </Badge>
      </div>
      <Separator />

      {/* Stats counter row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1 */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">Online Cameras</CardDescription>
            <CardTitle className="text-2xl font-bold">3 / 4</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xxs text-muted-foreground">Camera 3 currently offline</p>
          </CardContent>
        </Card>

        {/* Metric 2 */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">Convex Queries</CardDescription>
            <CardTitle className="text-2xl font-bold">128 / sec</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xxs text-muted-foreground">Database latency: 4ms average</p>
          </CardContent>
        </Card>

        {/* Metric 3 */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">WebGPU Load</CardDescription>
            <CardTitle className="text-2xl font-bold">42%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xxs text-muted-foreground">Running RF-DETR segmentation</p>
          </CardContent>
        </Card>

        {/* Metric 4 */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">Threat Alerts (24h)</CardDescription>
            <CardTitle className="text-2xl font-bold text-status-critical">14</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xxs text-muted-foreground">4 alerts verified by second pass VLM</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Server metrics */}
        <Card>
          <CardHeader>
            <CardTitle>System Performance Logs</CardTitle>
            <CardDescription>Real-time server pipeline metrics.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span>Memory Allocation</span>
                <span className="font-mono">1,120MB / 4,096MB</span>
              </div>
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-status-nominal" style={{ width: "27%" }} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span>VLM Token Usage</span>
                <span className="font-mono">4.2k tokens / min</span>
              </div>
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-status-warning" style={{ width: "62%" }} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span>Worker Thread Pool</span>
                <span className="font-mono">2 / 4 active threads</span>
              </div>
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-status-nominal" style={{ width: "50%" }} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* System logs */}
        <Card className="flex flex-col h-[280px]">
          <CardHeader>
            <CardTitle>Core System Output</CardTitle>
            <CardDescription>Live stdout warnings from background workers.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto px-6 space-y-2 font-mono text-[10px] text-muted-foreground pb-6">
            <p className="text-foreground">[2026-07-06 22:50:01] INFO: Initializing WebGPU executor context...</p>
            <p className="text-status-nominal">[2026-07-06 22:50:03] SUCCESS: Loaded public/models/rf-detr-seg-nano.onnx</p>
            <p className="text-foreground">[2026-07-06 22:50:04] INFO: Connecting ConvexHttpClient to deployment endpoints</p>
            <p className="text-status-warning">[2026-07-06 22:51:15] WARN: Camera 3 stream disconnected. Retrying handshake in 5s...</p>
            <p className="text-foreground">[2026-07-06 22:51:20] INFO: Background VLM scheduler heartbeat ok</p>
            <p className="text-status-critical">[2026-07-06 22:52:00] ALARM: Weapon signature matched on Camera 1 (Conf 94%)</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
