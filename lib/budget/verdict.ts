/**
 * Structured threat-verdict parsing for the live /api/analyze path.
 *
 * Implements the parsing/coercion contract from
 * docs/live-detection-plan/05-DETECTION-AND-PROMPTS.md §6:
 * strip fences → JSON.parse → coerce against the §4.2 schema → enforce
 * invariants → on garbage, fail safe to a "none" verdict (never a false alert).
 *
 * Also adapts the legacy worker shape `{ isHarm, description }`
 * (apps/worker/watch/schema.ts) onto the richer live superset.
 */

export const THREAT_TYPES = [
  "weapon",
  "fight",
  "theft",
  "vandalism",
  "medical",
  "intrusion",
  "other",
  "none",
] as const;

export type ThreatType = (typeof THREAT_TYPES)[number];

export interface VerdictBox {
  readonly label: string;
  /** Normalized 0..1 coordinates. */
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface Verdict {
  readonly is_threat: boolean;
  readonly threat_type: ThreatType;
  readonly description: string;
  /** 0..1 certainty in the chosen label. */
  readonly confidence: number;
  readonly boxes: VerdictBox[];
}

export const NONE_VERDICT: Verdict = {
  is_threat: false,
  threat_type: "none",
  description: "",
  confidence: 0,
  boxes: [],
};

/** Strip ```json ... ``` markdown fences some models wrap JSON in. */
export function cleanJsonResponse(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, "");
    cleaned = cleaned.replace(/\n?```$/, "");
  }
  return cleaned.trim();
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function isValidBox(b: unknown): b is VerdictBox {
  if (typeof b !== "object" || b === null) return false;
  const box = b as Record<string, unknown>;
  return (
    typeof box.x1 === "number" &&
    typeof box.y1 === "number" &&
    typeof box.x2 === "number" &&
    typeof box.y2 === "number" &&
    box.x2 > box.x1 &&
    box.y2 > box.y1
  );
}

/**
 * Parse a raw model response into a Verdict. On a JSON.parse failure this
 * fails safe to a "none" verdict (log-less, cost-safe: the next keyframe
 * re-triggers). Throws on a parseable object that violates the
 * is_threat=true ⇒ non-empty description invariant — the caller may retry
 * once with a terse nudge before giving up.
 */
export function parseVerdict(raw: string): Verdict {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleanJsonResponse(raw)) as Record<string, unknown>;
  } catch {
    return NONE_VERDICT;
  }
  return coerceVerdictObject(obj);
}

/**
 * Coerce an already-parsed object (e.g. from a provider's structured output)
 * into a Verdict, applying all §4.2 invariants.
 */
export function coerceVerdictObject(obj: Record<string, unknown>): Verdict {
  // Legacy adapter: the worker schema speaks { isHarm, description }.
  const legacyIsHarm = obj.isHarm;
  const rawIsThreat = obj.is_threat;
  const isThreat =
    typeof rawIsThreat === "boolean"
      ? rawIsThreat
      : legacyIsHarm === true
        ? true
        : legacyIsHarm === false
          ? false
          : Boolean(rawIsThreat ?? false);

  const rawType = typeof obj.threat_type === "string" ? obj.threat_type : "";
  const knownType = (THREAT_TYPES as readonly string[]).includes(rawType)
    ? (rawType as ThreatType)
    : ("other" as ThreatType);
  const threatType: ThreatType = isThreat
    ? knownType === "none"
      ? "other"
      : knownType
    : "none";

  const description =
    typeof obj.description === "string" ? obj.description : "";

  if (isThreat && description.trim().length === 0) {
    throw new Error(
      "Invalid verdict JSON: 'description' must be non-empty when is_threat is true",
    );
  }

  const rawConfidence = Number(obj.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? clamp01(rawConfidence)
    : 0.5;

  const boxes = Array.isArray(obj.boxes)
    ? obj.boxes.filter(isValidBox)
    : [];

  return {
    is_threat: isThreat,
    threat_type: threatType,
    description: isThreat ? description : "",
    confidence: isThreat ? confidence : Math.min(confidence, 1),
    boxes,
  };
}

/**
 * Severity for the Convex threatLogs table: ≥90 critical, ≥75 warning,
 * else nominal (convex/threatLogs.ts classifySeverity).
 */
export function severityFromConfidence(
  confidence: number,
): "critical" | "warning" | "nominal" {
  if (confidence >= 0.9) return "critical";
  if (confidence >= 0.75) return "warning";
  return "nominal";
}

/**
 * Severity to DISPLAY for a confirmed threat (`is_threat === true`).
 *
 * Deliberately stricter than `severityFromConfidence`, which labels the STORED
 * severity of a threat log: that tiering bottoms out at "nominal", and the
 * alert surface suppresses toasts for nominal entries — so a weapon the model
 * reported at 60% confidence was filed as routine and never notified. A verdict
 * only reaches the alert surface after the vision model flagged it (and, when
 * the budget allowed, a second independent pass agreed), so its confidence must
 * never be the reason the operator is not told: confidence picks between
 * critical and warning, never between alerting and silence.
 */
export function threatAlertSeverity(confidence: number): "critical" | "warning" {
  return confidence >= 0.9 ? "critical" : "warning";
}

/** Human label for a threat_type, used as the Convex `classification`. */
export function classificationForType(type: ThreatType): string {
  const map: Record<ThreatType, string> = {
    weapon: "Weapon detected",
    fight: "Physical altercation",
    theft: "Suspected theft",
    vandalism: "Vandalism in progress",
    medical: "Medical emergency",
    intrusion: "Unauthorized intrusion",
    other: "Threat detected",
    none: "No threat",
  };
  return map[type];
}
