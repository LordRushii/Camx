"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BudgetState } from "@/hooks/useThreatAnalyzer";

/**
 * Live budget/usage meter (Phase 4, 03-FREE-TIER-BUDGET.md §6 UI surfacing).
 *
 * Green: under the warn threshold. Amber: at/over warnPct of budget.
 * Red: exhausted — the system is on LM Studio fallback or paused, never
 * silently burning hosted quota.
 */

export function UsageMeter({
  budget,
  provider,
  phase,
  degraded,
  lastGateReasons,
}: {
  budget: BudgetState | null;
  provider: string | null;
  phase: string;
  /** True when cloud budgets are exhausted and analysis is on LM Studio local. */
  degraded: boolean;
  lastGateReasons: readonly string[];
}) {
  const pct =
    budget && budget.dailyBudget > 0
      ? Math.min(100, Math.round((budget.usedToday / budget.dailyBudget) * 100))
      : 0;
  const state: "green" | "amber" | "red" =
    pct >= 100 ? "red" : budget && pct >= budget.warnPct ? "amber" : "green";

  const colorClass =
    state === "red"
      ? "bg-status-critical/10 text-status-critical border-status-critical/30"
      : state === "amber"
        ? "bg-status-warning/10 text-status-warning border-status-warning/30"
        : "bg-status-nominal/10 text-status-nominal border-status-nominal/30";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">LLM Budget</CardTitle>
          <Badge variant="outline" className={`text-xxs px-1.5 py-0 ${colorClass}`}>
            {state}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {budget ? (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Calls today</span>
              <span className="font-mono">
                {budget.usedToday} / {budget.dailyBudget} ({pct}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Session</span>
              <span className="font-mono">
                {budget.sessionUsed} / {budget.sessionBudget}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Remaining</span>
              <span className="font-mono">{budget.remaining}</span>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">No analysis yet — budget appears after the first gate event.</p>
        )}
        <div className="flex justify-between border-t border-border/30 pt-2">
          <span className="text-muted-foreground">Analyzer</span>
          <span className="font-mono capitalize">{phase}</span>
        </div>
        {provider && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Provider</span>
            <span className="font-mono">{provider}</span>
          </div>
        )}
        {degraded && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Mode</span>
            <span className="font-mono text-status-warning">local fallback (budget spent)</span>
          </div>
        )}
        {lastGateReasons.length > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Gate</span>
            <span className="font-mono text-[10px]">{lastGateReasons.join(" · ") || "dropped"}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
