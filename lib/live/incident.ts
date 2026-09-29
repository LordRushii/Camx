/**
 * Incident state machine (Stage 2 of the live-crime mission).
 *
 * Turns a stream of per-camera verdicts into incident state plus outward
 * `notify` intents. It is a PURE reducer: no timers, no DOM, no network, and the
 * clock is injected through each observation's `timestampMs`. The alert surface
 * (Stage 9) is the only thing that fires toasts, so notification policy lives
 * here where it can be unit-tested instead of inside a React effect.
 *
 * An incident is keyed by camera + threat type, so a knife and a fight on the
 * same feed are tracked — and resolved — independently, and cameras never share
 * state.
 *
 * Every notice kind below exists for a specific outward action in Stage 9:
 * `opened`/`repeated` show or refresh the top-right alert, `overturned` replaces
 * it with a false-alarm variant, and `resolved` clears the banner and marks the
 * bell entry. `confirmed` is deliberately NOT a notice: confirmation upgrades an
 * alert that already fired, so it must never toast again.
 */
import type { ThreatType } from "../budget/verdict";

export interface IncidentObservation {
  readonly cameraId: string;
  readonly cameraLabel?: string;
  /** Injected clock: epoch ms of the frame this verdict came from. */
  readonly timestampMs: number;
  /** Identity of the frame, so the same evidence can never notify twice. */
  readonly frameId: string;
  readonly isThreat: boolean;
  /**
   * The shared verdict type (`lib/budget/verdict.ts`), not a bare string: the
   * coercion layer guarantees is_threat=true implies a real, non-"none" type,
   * which is what keeps the incident key space bounded to cameras × types.
   */
  readonly threatType: ThreatType;
  /** Short operator-facing headline, e.g. "one person holding a knife". */
  readonly summary: string;
  readonly description: string;
  readonly confidence: number;
  /** Optional frame snapshot carried into the alert. */
  readonly thumbnail?: string;
  /**
   * Result of the independent second pass for THIS frame, when one ran. A
   * confirmation only ever updates an incident that is already open — it never
   * opens one, because a confirmation with no alert to correct is meaningless.
   */
  readonly confirmation?: "confirmed" | "overturned";
}

export interface Incident {
  /** Stable key: `${cameraId}:${threatType}`. */
  readonly id: string;
  readonly cameraId: string;
  readonly cameraLabel?: string;
  readonly threatType: ThreatType;
  readonly summary: string;
  readonly description: string;
  readonly confidence: number;
  readonly thumbnail?: string;
  readonly status: IncidentStatus;
  /** Epoch ms the incident opened. */
  readonly openedAt: number;
  /** Epoch ms the incident was resolved or retracted. */
  readonly resolvedAt?: number;
  /** Epoch ms of the newest evidence seen for this incident. */
  readonly lastSeenAt: number;
  /** Epoch ms of the last operator notification (alert). */
  readonly lastNotifiedAt: number;
  /** How many alerts this incident has raised, so the UI can show escalation. */
  readonly notifyCount: number;
}

export type IncidentStatus = "open" | "confirmed" | "overturned" | "resolved";

/** Kinds that require an outward action; `confirmed` is state-only by design. */
export type IncidentNoticeKind = "opened" | "repeated" | "overturned" | "resolved";

export interface IncidentNotice {
  readonly kind: IncidentNoticeKind;
  /**
   * The alert the operator sees. The headline is `incident.summary` and the
   * frame snapshot is `incident.thumbnail`, so there is one copy of each rather
   * than a parallel field that can drift.
   */
  readonly incident: Incident;
  readonly timestampMs: number;
}

export interface IncidentState {
  /** Keyed by incident id (`${cameraId}:${threatType}`). */
  readonly incidents: Readonly<Record<string, Incident>>;
  /** Negative frames seen in a row per incident id — the resolution streak. */
  readonly consecutiveNegatives: Readonly<Record<string, number>>;
  /**
   * Last frame accepted per camera. Evidence is identified by frame, not by
   * arrival time, so a replayed frame can never notify twice — nor count three
   * times toward a resolution.
   */
  readonly lastFrameId: Readonly<Record<string, string>>;
}

export interface IncidentOutcome {
  readonly state: IncidentState;
  readonly notices: readonly IncidentNotice[];
}

/** A sustained threat re-notifies the operator at most once per this window. */
const NOTIFY_THROTTLE_MS = 30_000;

/** Consecutive clean frames that close an incident (~9s at the 3s cadence). */
const RESOLVE_AFTER_NEGATIVES = 3;

export function createIncidentState(): IncidentState {
  return { incidents: {}, consecutiveNegatives: {}, lastFrameId: {} };
}

function incidentId(cameraId: string, threatType: ThreatType): string {
  return `${cameraId}:${threatType}`;
}

/** Only open/confirmed incidents are live; resolved and retracted ones are done. */
function isActiveStatus(status: IncidentStatus): boolean {
  return status === "open" || status === "confirmed";
}

/** Camera ids with at least one active incident (feeds the boosted cadence). */
export function incidentCameraIds(state: IncidentState): readonly string[] {
  const cameraIds: string[] = [];
  for (const incident of Object.values(state.incidents)) {
    if (!isActiveStatus(incident.status)) continue;
    if (!cameraIds.includes(incident.cameraId)) cameraIds.push(incident.cameraId);
  }
  return cameraIds;
}

/** The evidence fields an incident carries forward from each observation. */
function evidenceFrom(observation: IncidentObservation) {
  return {
    cameraLabel: observation.cameraLabel,
    description: observation.description,
    confidence: observation.confidence,
    thumbnail: observation.thumbnail,
  };
}

/** Apply one verdict, returning the next state and any outward notify intents. */
export function applyVerdict(
  state: IncidentState,
  observation: IncidentObservation,
): IncidentOutcome {
  // The confirmation pass is checked FIRST, before frame-identity dedupe: it
  // legitimately refers to the same frame the triage verdict came from, and it
  // is not new evidence, so it neither refreshes the frame record nor is it
  // suppressed by it. Both outcomes are idempotent, so a replayed confirmation
  // is inert rather than a second retraction.
  if (observation.confirmation) {
    return applyConfirmation(state, observation);
  }

  // Same evidence, once. A replayed frame is a no-op no matter how much time
  // has passed, so neither the throttle nor the resolution streak can be gamed
  // by re-processing one image.
  if (state.lastFrameId[observation.cameraId] === observation.frameId) {
    return { state, notices: [] };
  }
  const accepted: IncidentState = {
    ...state,
    lastFrameId: { ...state.lastFrameId, [observation.cameraId]: observation.frameId },
  };

  if (!observation.isThreat) {
    return applyNegative(accepted, observation);
  }

  const id = incidentId(observation.cameraId, observation.threatType);
  const existing = accepted.incidents[id];

  // First evidence of this threat — or the threat returning after it was
  // resolved/retracted — opens a fresh incident and alerts immediately. A new
  // incident must never inherit the previous one's throttle window, otherwise a
  // repeating threat would stay silent.
  const startsFresh = !existing || existing.status === "resolved" || existing.status === "overturned";

  if (startsFresh) {
    const incident: Incident = {
      id,
      cameraId: observation.cameraId,
      threatType: observation.threatType,
      summary: observation.summary,
      status: "open",
      openedAt: observation.timestampMs,
      lastSeenAt: observation.timestampMs,
      lastNotifiedAt: observation.timestampMs,
      notifyCount: 1,
      ...evidenceFrom(observation),
    };

    return {
      state: {
        ...accepted,
        incidents: { ...accepted.incidents, [id]: incident },
        consecutiveNegatives: { ...accepted.consecutiveNegatives, [id]: 0 },
      },
      notices: [{ kind: "opened", incident, timestampMs: observation.timestampMs }],
    };
  }

  // Sustained threat: always refresh the evidence (the operator's alert should
  // describe what is happening NOW), but re-alert only at the throttle boundary
  // so a weapon held in frame does not toast on every frame.
  const reNotify = observation.timestampMs - existing.lastNotifiedAt >= NOTIFY_THROTTLE_MS;
  const incident: Incident = {
    ...existing,
    summary: observation.summary,
    lastSeenAt: observation.timestampMs,
    lastNotifiedAt: reNotify ? observation.timestampMs : existing.lastNotifiedAt,
    notifyCount: reNotify ? existing.notifyCount + 1 : existing.notifyCount,
    ...evidenceFrom(observation),
  };

  return {
    state: {
      ...accepted,
      incidents: { ...accepted.incidents, [id]: incident },
      // A fresh sighting restarts the resolution streak.
      consecutiveNegatives: { ...accepted.consecutiveNegatives, [id]: 0 },
    },
    notices: reNotify
      ? [{ kind: "repeated", incident, timestampMs: observation.timestampMs }]
      : [],
  };
}

/**
 * Apply the second-pass result. `confirmed` upgrades the alert in place and is
 * deliberately silent (the operator was already notified). `overturned` retracts
 * it, which the alert surface renders as a false alarm.
 */
function applyConfirmation(
  state: IncidentState,
  observation: IncidentObservation,
): IncidentOutcome {
  const id = incidentId(observation.cameraId, observation.threatType);
  const existing = state.incidents[id];
  if (!existing || !isActiveStatus(existing.status)) {
    return { state, notices: [] };
  }

  if (observation.confirmation === "confirmed") {
    return {
      state: {
        ...state,
        incidents: { ...state.incidents, [id]: { ...existing, status: "confirmed" } },
      },
      notices: [],
    };
  }

  const overturned: Incident = {
    ...existing,
    status: "overturned",
    resolvedAt: observation.timestampMs,
  };
  return {
    state: { ...state, incidents: { ...state.incidents, [id]: overturned } },
    notices: [{ kind: "overturned", incident: overturned, timestampMs: observation.timestampMs }],
  };
}

/**
 * A clean frame counts against EVERY incident on that camera — the frame shows
 * no attack, so it is evidence for closing all of them — and three clean frames
 * in a row resolve the incident and retract its banner.
 */
function applyNegative(
  state: IncidentState,
  observation: IncidentObservation,
): IncidentOutcome {
  const incidents: Record<string, Incident> = { ...state.incidents };
  const consecutiveNegatives: Record<string, number> = { ...state.consecutiveNegatives };
  const notices: IncidentNotice[] = [];
  let changed = false;

  for (const [id, incident] of Object.entries(state.incidents)) {
    if (incident.cameraId !== observation.cameraId) continue;
    if (!isActiveStatus(incident.status)) continue;

    const streak = (consecutiveNegatives[id] ?? 0) + 1;
    consecutiveNegatives[id] = streak;
    changed = true;

    if (streak < RESOLVE_AFTER_NEGATIVES) continue;

    const resolved: Incident = {
      ...incident,
      status: "resolved",
      resolvedAt: observation.timestampMs,
    };
    incidents[id] = resolved;
    notices.push({ kind: "resolved", incident: resolved, timestampMs: observation.timestampMs });
  }

  if (!changed) return { state, notices: [] };
  return { state: { ...state, incidents, consecutiveNegatives }, notices };
}
