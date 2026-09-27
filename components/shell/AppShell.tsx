"use client";

import type React from "react";
import { TopNav } from "./TopNav";
import { AlertProvider, AlertPanel, useAlerts } from "@/components/alerts";

function AlertPanelHost({ children }: { readonly children: React.ReactNode }) {
  const { panelOpen } = useAlerts();
  return (
    <div className="flex h-full w-full overflow-hidden">
      <main className="flex-1 overflow-y-auto">{children}</main>
      {panelOpen && <AlertPanel />}
    </div>
  );
}

export function AppShell({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <AlertProvider>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
        <TopNav />
        <AlertPanelHost>{children}</AlertPanelHost>
      </div>
    </AlertProvider>
  );
}
