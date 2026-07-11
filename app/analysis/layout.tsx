import type { ReactNode } from "react";
import { Suspense } from "react";
import { AnalysisShell } from "@/components/analysis/analysis-shell";
import { AnalysisSessionProvider } from "@/components/analysis/video-watch-session";

export default function AnalysisLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center bg-op-surface font-mono text-xs text-op-text-sec h-full w-full">
        Loading Analysis Session...
      </div>
    }>
      <AnalysisSessionProvider>
        <AnalysisShell>{children}</AnalysisShell>
      </AnalysisSessionProvider>
    </Suspense>
  );
}
