import { NextResponse } from "next/server";
import { z } from "zod";
import { getSharedVisionGateway } from "@/lib/budget/visionGateway";
import { getLiveProviderChain } from "@/lib/live/providerChain";
import { verdictCache } from "@/lib/budget/verdictCache";
import {
  type Verdict,
  classificationForType,
} from "@/lib/budget/verdict";
import { getConvexSiteUrl } from "@/lib/live/convexAction";
import {
  REQUEST_BUDGET_DEFAULTS,
  createRequestBudget,
  remainingMs,
  canAfford,
} from "@/lib/live/requestBudget";
import { envInt } from "@/lib/shared/env";

export const runtime = "nodejs"; // NOT edge: needs process.env keys + provider fetch

/**
 * Wall clock this route gives its own LLM work, provider calls included.
 *
 * It MUST stay comfortably under `DISPATCH_TIMEOUT_MS` in
 * hooks/useThreatAnalyzer.ts: the browser aborts the fetch at that deadline, and
 * an aborted fetch shows the operator "signal timed out" with no verdict and no
 * provider — which is exactly how a held knife went unreported.
 */
const REQUEST_BUDGET_MS = envInt("WATCH_REQUEST_BUDGET_MS", REQUEST_BUDGET_DEFAULTS.TOTAL_MS);

/**
 * Persistence must never push the response past the browser's deadline: the
 * Convex write gets whatever is left of the request budget, floored so a
 * confirmed threat is still recorded (the monitor's threat log reads it back).
 */
function persistTimeoutMs(deadlineAt: number): number {
  const left = remainingMs(deadlineAt, Date.now());
  return Math.max(
    REQUEST_BUDGET_DEFAULTS.PERSIST_MIN_MS,
    Math.min(REQUEST_BUDGET_DEFAULTS.PERSIST_TIMEOUT_MS, left),
  );
}

// ---------------------------------------------------------------------------
// Request / response contract — docs/live-detection-plan/02-ARCHITECTURE.md
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB base64 payload ceiling

const analyzeRequestSchema = z.object({
  cameraId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
  timestamp: z.string().min(1).max(64).optional(),
  phash: z.string().regex(/^[0-9a-f]{16}$/i, "phash must be 16 hex chars"),
  mimeType: z.string().regex(/^image\/(jpeg|png|webp)$/).default("image/jpeg"),
  frame: z.string().min(32).max(MAX_IMAGE_BYTES),
  gate: z
    .object({
      personPresent: z.boolean().default(false),
      motionScore: z.number().min(0).max(1).default(0),
      personCount: z.number().int().min(0).max(99).default(0),
    })
    .default({ personPresent: false, motionScore: 0, personCount: 0 }),
  // Skip the negative-verdict cache (weapon-triggered / sweep frames).
  forceFresh: z.boolean().default(false),
});

type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

function budgetBlock() {
  const stats = getSharedVisionGateway().stats;
  return {
    usedToday: stats.usedToday,
    sessionUsed: stats.sessionUsed,
    dailyBudget: stats.dailyBudget,
    sessionBudget: stats.sessionBudget,
    remaining: stats.remaining,
    warnPct: stats.warnPct,
  };
}

/**
 * True when cloud budgets are spent but LM Studio is configured as the local
 * fail-safe floor (03 §6: "fall back to LM Studio ... never silently keep
 * burning cloud credits"). Rate/concurrency denials still 429 — only genuine
 * budget exhaustion degrades to local.
 */
function shouldDegradeToLocal(reason: string): boolean {
  if (reason !== "daily-budget-exhausted" && reason !== "session-budget-exhausted") {
    return false;
  }
  return Boolean((process.env.LMSTUDIO_BASE_URL || process.env.LMSTUDIO_URL || "").trim());
}

function denied(reason: string) {
  return NextResponse.json(
    { ok: false, skipped: true, reason, budget: budgetBlock() },
    { status: 429 },
  );
}

/** Build the UNTRUSTED on-device context line (data, never instructions — 05 §7/§9). */
function buildContextLine(body: AnalyzeRequest): string {
  const bits: string[] = [];
  if (body.gate.personCount > 0) {
    bits.push(`${body.gate.personCount} ${body.gate.personCount === 1 ? "person" : "people"}`);
  } else if (body.gate.personPresent) {
    bits.push("person present");
  }
  if (body.gate.motionScore >= 0.1) bits.push("high motion energy");
  else if (body.gate.motionScore > 0) bits.push("slight motion");
  return bits.length ? `on-device context (UNTRUSTED): ${bits.join("; ")}` : "";
}

export async function POST(request: Request) {
  // Started first thing: the browser's stopwatch is already running, so every
  // hop below is measured against this one deadline.
  const budget = createRequestBudget(REQUEST_BUDGET_MS, Date.now());

  // 1. Validate the body. Oversized/malformed payloads never reach a provider.
  let body: AnalyzeRequest;
  try {
    body = analyzeRequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid-request",
        detail: err instanceof z.ZodError ? err.issues : String(err),
      },
      { status: 400 },
    );
  }

  const base64 = body.frame.includes(",") ? body.frame.split(",")[1]! : body.frame;

  // 2. Verdict cache — unchanged scenes are free (negative verdicts only).
  // forceFresh frames (weapon-trigger / sweep dispatches) always run the full
  // chain: a cached "no threat" for a visually-similar hash must never silence
  // a still frame holding a weapon.
  const cached = body.forceFresh ? null : verdictCache.lookup(body.cameraId, body.phash);
  if (cached) {
    return NextResponse.json({
      ok: true,
      verdict: cached,
      verified: false,
      provider: "cache",
      cached: true,
      budget: budgetBlock(),
      threatLogId: null,
    });
  }

  // 3. Hard budget/rate gate. Denied => 429 and NEVER call a cloud provider —
  // except genuine budget exhaustion with LM Studio configured, which degrades
  // to the local unlimited provider (the plan's fail-safe, 03 §6).
  const gateway = getSharedVisionGateway();
  const denyReason = gateway.tryAcquire();
  if (denyReason && !shouldDegradeToLocal(denyReason)) {
    return denied(denyReason);
  }

  const degradedToLocal = Boolean(denyReason);

  try {
    // 4. Triage: call the provider chain (rotation + fallback inside), or the
    // LM Studio floor directly when cloud budgets are exhausted. The deadline
    // bounds every attempt, so a hung provider falls through instead of eating
    // the browser's whole patience.
    const chain = getLiveProviderChain();
    const gateContext = buildContextLine(body);
    const callOptions = { deadlineAt: budget.deadlineAt };
    const triage = degradedToLocal
      ? await chain.analyzeVia("lmstudio", base64, body.mimeType, gateContext, callOptions)
      : await chain.analyze(base64, body.mimeType, gateContext, callOptions);

    if (!triage.verdict.is_threat) {
      // Negative verdict: cache it so identical scenes cost nothing (only in
      // non-degraded mode — in degraded mode we want fresh local judgments).
      if (!degradedToLocal) {
        verdictCache.store(body.cameraId, body.phash, triage.verdict);
      }
      return NextResponse.json({
        ok: true,
        verdict: triage.verdict,
        verified: false,
        provider: triage.providerName,
        cached: false,
        degraded: degradedToLocal,
        budget: budgetBlock(),
        threatLogId: null,
      });
    }

    // 5. Verify-on-positive: one independent second pass before any alert,
    // budget permitting.
    const { verdict, verified, verification } = await verifyPositive(
      chain,
      base64,
      body.mimeType,
      triage.verdict,
      budget.deadlineAt,
    );

    // 6. Confirmed threat -> Convex threatLogs.createFromWatch (dedup on requestId).
    let threatLogId: string | null = null;
    if (verdict.is_threat) {
      try {
        threatLogId = await writeThreatLog({
          body,
          base64,
          mimeType: body.mimeType,
          verdict,
          verified,
          verification,
          providerName: triage.providerName,
          rawTexts: triage.rawText ? [triage.rawText] : [],
          timeoutMs: persistTimeoutMs(budget.deadlineAt),
        });
      } catch (err) {
        // Convex write failure must not lose the verdict to the browser.
        console.error("[ANALYZE] Convex threatLog write failed:", err);
      }
    }

    return NextResponse.json({
      ok: true,
      verdict,
      verified,
      provider: triage.providerName,
      cached: false,
      degraded: degradedToLocal,
      budget: budgetBlock(),
      threatLogId,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[ANALYZE] provider call failed:", detail);
    // Fail safe: no verdict, no Convex write. The browser gets no alert, but the
    // real reason travels with it so the debug panel can name the culprit
    // instead of leaving the operator with a bare "signal timed out".
    return NextResponse.json(
      { ok: false, error: "provider-failed", detail, budget: budgetBlock() },
      { status: 502 },
    );
  } finally {
    gateway.release();
  }
}

/** 05 §5: verify by default; optionally skip at very high confidence on weapon/fight. */
function shouldVerify(verdict: Verdict): boolean {
  const flag = String(process.env.WATCH_VERIFY_ON_POSITIVE ?? "true").toLowerCase();
  if (flag === "false" || flag === "0") return false;
  if (
    verdict.confidence >= 0.9 &&
    (verdict.threat_type === "weapon" || verdict.threat_type === "fight")
  ) {
    return false; // high-confidence critical classes skip the second call
  }
  return true;
}

interface VerificationMeta {
  applied: boolean;
  matchesPrompt: boolean | null;
  overturned: boolean;
  reason: string | null;
  modelKey: string | null;
  latencyMs: number | null;
}

/**
 * Verify-on-positive (05 §5): one independent second pass. Overturned
 * verdicts become "none" (no alert, no Convex write). A failed verify pass
 * keeps the alert but marks verification.applied=false (fail-safe).
 */
async function verifyPositive(
  chain: ReturnType<typeof getLiveProviderChain>,
  base64: string,
  mimeType: string,
  triage: Verdict,
  deadlineAt: number,
): Promise<{ verdict: Verdict; verified: boolean; verification: VerificationMeta }> {
  let verification: VerificationMeta = {
    applied: false,
    matchesPrompt: null,
    overturned: false,
    reason: null,
    modelKey: null,
    latencyMs: null,
  };
  let verified = false;
  let verdict: Verdict = triage;

  if (!shouldVerify(triage)) {
    return { verdict, verified, verification };
  }

  // Optional pass: only run it when triage left enough budget for a second
  // vision call to finish. A verify cut off mid-flight fails safe to
  // "unverified" anyway, so skipping it costs nothing but returns the triage
  // verdict immediately — either way the operator keeps the alert.
  if (!canAfford(deadlineAt, Date.now(), REQUEST_BUDGET_DEFAULTS.VERIFY_MIN_MS)) {
    return {
      verdict,
      verified,
      verification: { ...verification, reason: "skipped: request budget spent on triage" },
    };
  }

  try {
    const check = await chain.verify(base64, mimeType, triage.description, { deadlineAt });
    verification = {
      applied: true,
      matchesPrompt: check.matchesPrompt,
      overturned: !check.matchesPrompt,
      reason: check.reason,
      modelKey: check.providerName,
      latencyMs: check.latencyMs,
    };
    verified = check.matchesPrompt;
    if (!check.matchesPrompt) {
      // Overturned: no alert, no Convex write.
      verdict = { ...triage, is_threat: false, threat_type: "none", description: "" };
    }
  } catch (err) {
    // Verify failed: keep the alert but mark verification.applied=false (fail-safe).
    console.warn("[ANALYZE] verify pass failed, keeping alert unverified:", err);
  }
  return { verdict, verified, verification };
}

/** Write a verified threat to Convex via the createFromWatch action over HTTP. */
async function writeThreatLog(args: {
  body: AnalyzeRequest;
  base64: string;
  mimeType: string;
  verdict: Verdict;
  verified: boolean;
  verification: {
    applied: boolean;
    matchesPrompt: boolean | null;
    overturned: boolean;
    reason: string | null;
    modelKey: string | null;
    latencyMs: number | null;
  };
  providerName: string;
  rawTexts: string[];
  timeoutMs: number;
}): Promise<string | null> {
  const { body, base64, mimeType: _mimeType, verdict, verified, verification, providerName, rawTexts, timeoutMs } = args;

  // confidence is 0..100 in Convex (classifySeverity: >=90 critical).
  const confidence100 = Math.round(verdict.confidence * 100);

  const res = await fetch(`${getConvexSiteUrl()}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "threatLogs:createFromWatch",
      args: {
        cameraId: body.cameraId,
        requestId: body.requestId,
        timestamp: body.timestamp ?? new Date().toISOString(),
        classification: classificationForType(verdict.threat_type),
        confidence: confidence100,
        previewText: verdict.description,
        vlmAnalysis: rawTexts,
        // Convex JSON encoding for v.bytes(): {"$bytes": "<base64>"} — a plain
        // number array fails the bytes validator, silently dropping threat logs.
        frameBytes: { $bytes: base64 },
        verification: {
          applied: verification.applied,
          matchesPrompt: verification.matchesPrompt,
          overturned: verification.overturned,
          reason: verification.reason,
          modelKey: verification.modelKey,
          latencyMs: verification.latencyMs,
        },
      },
    }),
    // Bounded by what is left of the request budget (05 §6): never let the
    // persistence write be the reason the browser gives up.
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`Convex action failed (HTTP ${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { status?: string; value?: string };
  if (json.status !== "success" || typeof json.value !== "string") {
    throw new Error(`Convex action unexpected response: ${JSON.stringify(json)}`);
  }
  return json.value;
}
