"use client";

import type React from "react";
import { TopNav } from "./TopNav";

export function AppShell({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <TopNav />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
