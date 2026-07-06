"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface EnrolledSubject {
  id: string;
  name: string;
  role: "employee" | "visitor" | "unknown" | "flagged";
  enrolledAt: string;
  imagesCount: number;
}

export default function FaceEnrollmentPage() {
  const [subjects, setSubjects] = useState<EnrolledSubject[]>([
    { id: "sub-1", name: "Alice Vance", role: "employee", enrolledAt: "2026-06-15", imagesCount: 12 },
    { id: "sub-2", name: "Bob Miller", role: "visitor", enrolledAt: "2026-07-01", imagesCount: 6 },
    { id: "sub-3", name: "Charlie Unknown", role: "flagged", enrolledAt: "2026-07-05", imagesCount: 3 },
  ]);

  const [newName, setNewName] = useState("");

  const handleEnroll = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const newSub: EnrolledSubject = {
      id: `sub-${Date.now()}`,
      name: newName,
      role: "visitor",
      enrolledAt: new Date().toISOString().split("T")[0],
      imagesCount: 1,
    };

    setSubjects((prev) => [...prev, newSub]);
    setNewName("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Face Enrollment</h3>
          <p className="text-sm text-muted-foreground">
            Manage authorized facial records and handle matching conflicts.
          </p>
        </div>
        <Link
          href="/settings/face-enrollment/conflict"
          className={buttonVariants({ variant: "outline", className: "cursor-pointer" })}
        >
          View Conflicts
        </Link>
      </div>
      <Separator />

      <div className="grid gap-6 md:grid-cols-3">
        {/* Enrolled subjects grid */}
        <div className="md:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Enrolled Personnel</CardTitle>
              <CardDescription>
                Facial recognition database profiles.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {subjects.map((subject) => (
                <div
                  key={subject.id}
                  className="flex flex-col justify-between p-4 rounded-lg border border-border bg-background hover:bg-muted/10 transition-colors"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{subject.name}</span>
                      <Badge
                        variant="outline"
                        className={
                          subject.role === "employee"
                            ? "bg-status-nominal/10 text-status-nominal border-status-nominal/30"
                            : subject.role === "visitor"
                              ? "bg-status-warning/10 text-status-warning border-status-warning/30"
                              : "bg-status-critical/10 text-status-critical border-status-critical/30"
                        }
                      >
                        {subject.role}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Enrolled: {subject.enrolledAt}</p>
                    <p className="text-xs text-muted-foreground">{subject.imagesCount} reference photos</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Enroll form */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Enroll Portrait</CardTitle>
              <CardDescription>Upload reference photo and assign profile details.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEnroll} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="subject-name" className="text-xs font-semibold text-muted-foreground">
                    Full Name
                  </label>
                  <Input
                    id="subject-name"
                    placeholder="e.g. David Smith"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="portrait-upload" className="text-xs font-semibold text-muted-foreground">
                    Upload Portrait
                  </label>
                  <Input id="portrait-upload" type="file" accept="image/*" className="cursor-pointer" />
                </div>
                <Button type="submit" className="w-full cursor-pointer">
                  Register Subject
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
