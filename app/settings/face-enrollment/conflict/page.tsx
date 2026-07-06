"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function ConflictResolutionPage() {
  const [conflictResolved, setConflictResolved] = useState(false);

  const handleResolve = (action: string) => {
    alert(`Conflict resolved by choosing: ${action}`);
    setConflictResolved(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/settings/face-enrollment"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "cursor-pointer" })}
        >
          ← Back
        </Link>
        <div>
          <h3 className="text-lg font-medium">Conflict Resolution</h3>
          <p className="text-sm text-muted-foreground">
            Resolve overlapping face records and duplicate matching anomalies.
          </p>
        </div>
      </div>
      <Separator />

      {!conflictResolved ? (
        <Card>
          <CardHeader>
            <CardTitle>Matching Conflict Detected</CardTitle>
            <CardDescription>
              Two entries are matching the same camera face template. Review and merge profiles.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            {/* Subject 1 */}
            <div className="p-4 rounded-lg border border-border bg-background space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Subject A: Charlie Unknown</span>
                <Badge variant="outline" className="bg-status-critical/10 text-status-critical border-status-critical/30">
                  Flagged
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Enrolled: 2026-07-05</p>
              <div className="w-full h-32 bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground">
                [Portrait Placeholder A]
              </div>
              <p className="text-xs">
                Matched 3 times with a similarity score of <span className="font-mono font-bold">92.4%</span>.
              </p>
            </div>

            {/* Subject 2 */}
            <div className="p-4 rounded-lg border border-border bg-background space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Subject B: Charles Smith</span>
                <Badge variant="outline" className="bg-status-warning/10 text-status-warning border-status-warning/30">
                  Visitor
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Enrolled: 2026-07-06</p>
              <div className="w-full h-32 bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground">
                [Portrait Placeholder B]
              </div>
              <p className="text-xs">
                Matched 1 time with a similarity score of <span className="font-mono font-bold">90.1%</span>.
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => handleResolve("Keep Both")} className="cursor-pointer">
              Keep Both Profiles
            </Button>
            <Button onClick={() => handleResolve("Merge A into B")} className="cursor-pointer">
              Merge A into B
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <h4 className="font-semibold text-status-nominal text-base">No active conflicts!</h4>
            <p className="text-xs text-muted-foreground">All face data matches are within standard deviation parameters.</p>
            <Link
              href="/settings/face-enrollment"
              className={buttonVariants({ variant: "outline", className: "mt-4 cursor-pointer" })}
            >
              Return to Enrollment
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
