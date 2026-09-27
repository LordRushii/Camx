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

export const runtime = "nodejs"; // NOT edge: needs process.env keys + provider fetch

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
  const cached = verdictCache.lookup(body.cameraId, body.phash);
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
    // LM Studio floor directly when cloud budgets are exhausted.
    const chain = getLiveProviderChain();
    const gateContext = buildContextLine(body);
    const triage = degradedToLocal
      ? await chain.analyzeVia("lmstudio", base64, body.mimeType, gateContext)
      : await chain.analyze(base64, body.mimeType, gateContext);

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

    // 5. Verify-on-positive: one independent second pass before any alert.
    const { verdict, verified, verification } = await verifyPositive(chain, base64, body.mimeType, triage.verdict);

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
    console.error("[ANALYZE] provider call failed:", err instanceof Error ? err.message : err);
    // Fail safe: no verdict, no Convex write. The browser simply gets no alert.
    return NextResponse.json(
      { ok: false, error: "provider-failed", budget: budgetBlock() },
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

  try {
    const check = await chain.verify(base64, mimeType, triage.description);
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
}): Promise<string | null> {
  const { body, base64, mimeType: _mimeType, verdict, verified, verification, providerName, rawTexts } = args;

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
    // 8s per-call deadline (05 §6): never block the browser loop.
    signal: AbortSignal.timeout(8000),
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
