"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

interface ThreatLog {
  id: string;
  timestamp: string;
  camera: string;
  detectedObject: string;
  confidence: number;
  status: "verified" | "overturned" | "unverified";
  details: string;
}

export default function ThreatLogPage() {
  const [logs, setLogs] = useState<ThreatLog[]>([
    { id: "log-1", timestamp: "2026-07-06 22:45:12", camera: "Camera 1", detectedObject: "Knife / Weapon", confidence: 94, status: "verified", details: "Initial VLM assessment verified presence of object." },
    { id: "log-2", timestamp: "2026-07-06 21:30:45", camera: "Camera 2", detectedObject: "Intruder / Backpack", confidence: 81, status: "overturned", details: "Second pass verification overturned detection: replica/toy backpack." },
    { id: "log-3", timestamp: "2026-07-06 20:15:10", camera: "Camera 4", detectedObject: "Person / Restrictive Boundary", confidence: 73, status: "unverified", details: "VLM assessment pending verification pass." },
    { id: "log-4", timestamp: "2026-07-06 18:02:59", camera: "Camera 1", detectedObject: "Firearm / Weapon", confidence: 98, status: "verified", details: "Verified threat alert broadcast to monitoring panel." },
  ]);

  const handleExport = () => {
    alert("Exporting threat log data to CSV...");
  };

  const handleResolve = (id: string) => {
    setLogs((prev) =>
      prev.map((log) => (log.id === id ? { ...log, status: "verified" } : log))
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Threat Log</h3>
          <p className="text-sm text-muted-foreground">
            Review security warnings and VLM verifier overrides.
          </p>
        </div>
        <Button onClick={handleExport} variant="outline" className="cursor-pointer">
          Export CSV
        </Button>
      </div>
      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Security Events</CardTitle>
          <CardDescription>
            Audit log of all high-severity threats detected by the local vision loops.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative w-full overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-left text-xs uppercase tracking-wider font-semibold">
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Target Object</th>
                  <th className="p-3">Confidence</th>
                  <th className="p-3">Verification</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/10 transition-colors">
                    <td className="p-3 font-mono text-xs text-muted-foreground">{log.timestamp}</td>
                    <td className="p-3 font-medium">{log.camera}</td>
                    <td className="p-3">{log.detectedObject}</td>
                    <td className="p-3 font-mono text-xs">{log.confidence}%</td>
                    <td className="p-3">
                      <Badge
                        variant="outline"
                        className={
                          log.status === "verified"
                            ? "bg-status-critical/10 text-status-critical border-status-critical/30"
                            : log.status === "overturned"
                              ? "bg-status-nominal/10 text-status-nominal border-status-nominal/30"
                              : "bg-status-warning/10 text-status-warning border-status-warning/30"
                        }
                      >
                        {log.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      {log.status === "unverified" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResolve(log.id)}
                          className="cursor-pointer"
                        >
                          Verify Threat
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Archived</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
