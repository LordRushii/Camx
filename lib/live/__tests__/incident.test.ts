import { describe, expect, it } from "vitest";
import {
  applyVerdict,
  createIncidentState,
  incidentCameraIds,
  type IncidentObservation,
} from "../incident";

/**
 * Expected values come from the approved Stage 2 spec, not from the
 * implementation: the first positive verdict notifies immediately, a sustained
 * threat re-notifies only at the 30s boundary, three consecutive negatives
 * resolve it, and the summary is what the operator reads.
 */
function observation(overrides: Partial<IncidentObservation> = {}): IncidentObservation {
  return {
    cameraId: "cam-a",
    cameraLabel: "Front Door",
    timestampMs: 1_000,
    frameId: "frame-1",
    isThreat: true,
    threatType: "weapon",
    summary: "one person holding a knife",
    description: "A person stands facing the camera holding a knife.",
    confidence: 0.9,
    thumbnail: "data:image/jpeg;base64,thumb",
    ...overrides,
  };
}

describe("incident — opening", () => {
  it("notifies once when the first positive verdict arrives", () => {
    const { state, notices } = applyVerdict(createIncidentState(), observation());

    expect(notices).toHaveLength(1);
    expect(notices[0]!.kind).toBe("opened");
    expect(notices[0]!.incident.id).toBe("cam-a:weapon");
    expect(notices[0]!.incident.status).toBe("open");
    expect(incidentCameraIds(state)).toEqual(["cam-a"]);
  });

  it("uses the summary as the notifiable headline and carries the thumbnail", () => {
    const { notices } = applyVerdict(createIncidentState(), observation());

    // The notice carries the incident, so the alert's headline IS the summary
    // (no second copy of it to drift out of sync) and the frame rides along.
    expect(notices[0]!.incident.summary).toBe("one person holding a knife");
    expect(notices[0]!.incident.thumbnail).toBe("data:image/jpeg;base64,thumb");
    expect(notices[0]!.incident.cameraLabel).toBe("Front Door");
  });

  it("stays silent for a negative verdict", () => {
    const { state, notices } = applyVerdict(
      createIncidentState(),
      observation({ isThreat: false, threatType: "none" }),
    );

    expect(notices).toEqual([]);
    expect(incidentCameraIds(state)).toEqual([]);
  });
});

describe("incident — sustained threat throttle", () => {
  it("stays silent inside the 30s boundary", () => {
    const first = applyVerdict(createIncidentState(), observation());
    const second = applyVerdict(
      first.state,
      observation({ timestampMs: 29_999, frameId: "frame-2" }),
    );

    expect(second.notices).toEqual([]);
    expect(second.state.incidents["cam-a:weapon"]!.status).toBe("open");
  });

  it("notifies again at the 30s boundary", () => {
    const first = applyVerdict(createIncidentState(), observation());
    const atBoundary = applyVerdict(
      first.state,
      observation({ timestampMs: 31_000, frameId: "frame-2" }),
    );

    expect(atBoundary.notices).toHaveLength(1);
    expect(atBoundary.notices[0]!.kind).toBe("repeated");
    expect(atBoundary.notices[0]!.incident.summary).toBe("one person holding a knife");
  });

  it("counts every notification so the alert can show escalation", () => {
    const first = applyVerdict(createIncidentState(), observation());
    const again = applyVerdict(
      first.state,
      observation({ timestampMs: 31_000, frameId: "frame-2" }),
    );

    expect(first.state.incidents["cam-a:weapon"]!.notifyCount).toBe(1);
    expect(again.state.incidents["cam-a:weapon"]!.notifyCount).toBe(2);
  });

  it("refreshes the incident with the newest evidence while staying silent", () => {
    const first = applyVerdict(createIncidentState(), observation());
    const refreshed = applyVerdict(
      first.state,
      observation({
        timestampMs: 5_000,
        frameId: "frame-2",
        summary: "person now raising the knife",
        confidence: 0.96,
        thumbnail: "data:image/jpeg;base64,thumb2",
      }),
    );

    const incident = refreshed.state.incidents["cam-a:weapon"]!;
    expect(refreshed.notices).toEqual([]);
    expect(incident.summary).toBe("person now raising the knife");
    expect(incident.confidence).toBe(0.96);
    expect(incident.thumbnail).toBe("data:image/jpeg;base64,thumb2");
    expect(incident.lastSeenAt).toBe(5_000);
  });
});

describe("incident — resolution", () => {
  const negative = (timestampMs: number, frameId: string): IncidentObservation =>
    observation({ isThreat: false, threatType: "none", timestampMs, frameId });

  it("resolves and clears after three consecutive negatives", () => {
    let outcome = applyVerdict(createIncidentState(), observation());
    outcome = applyVerdict(outcome.state, negative(4_000, "neg-1"));
    expect(outcome.notices).toEqual([]);
    outcome = applyVerdict(outcome.state, negative(7_000, "neg-2"));
    expect(outcome.notices).toEqual([]);

    outcome = applyVerdict(outcome.state, negative(10_000, "neg-3"));

    expect(outcome.notices).toHaveLength(1);
    expect(outcome.notices[0]!.kind).toBe("resolved");
    expect(outcome.notices[0]!.incident.id).toBe("cam-a:weapon");
    expect(outcome.state.incidents["cam-a:weapon"]!.status).toBe("resolved");
    expect(incidentCameraIds(outcome.state)).toEqual([]);
  });

  it("treats a positive frame as evidence and resets the negative streak", () => {
    let outcome = applyVerdict(createIncidentState(), observation());
    outcome = applyVerdict(outcome.state, negative(4_000, "neg-1"));
    outcome = applyVerdict(outcome.state, observation({ timestampMs: 5_000, frameId: "frame-2" }));
    outcome = applyVerdict(outcome.state, negative(8_000, "neg-2"));
    outcome = applyVerdict(outcome.state, negative(11_000, "neg-3"));

    // Only two negatives have landed since the threat was last seen.
    expect(outcome.notices).toEqual([]);
    expect(outcome.state.incidents["cam-a:weapon"]!.status).toBe("open");
  });

  it("notifies immediately when the threat reappears after a resolution", () => {
    let outcome = applyVerdict(createIncidentState(), observation());
    outcome = applyVerdict(outcome.state, negative(4_000, "neg-1"));
    outcome = applyVerdict(outcome.state, negative(7_000, "neg-2"));
    outcome = applyVerdict(outcome.state, negative(10_000, "neg-3"));

    // Well inside the old incident's 30s throttle window: a fresh incident must
    // still alert, otherwise a repeating threat would be silenced.
    const reopened = applyVerdict(
      outcome.state,
      observation({ timestampMs: 12_000, frameId: "frame-9" }),
    );

    expect(reopened.notices).toHaveLength(1);
    expect(reopened.notices[0]!.kind).toBe("opened");
    expect(reopened.notices[0]!.incident.notifyCount).toBe(1);
    expect(reopened.notices[0]!.incident.openedAt).toBe(12_000);
  });
});

describe("incident — confirmation pass", () => {
  it("marks the incident confirmed without alerting again", () => {
    const opened = applyVerdict(createIncidentState(), observation());
    const confirmed = applyVerdict(
      opened.state,
      observation({ timestampMs: 2_000, frameId: "frame-2", confirmation: "confirmed" }),
    );

    // The alert already fired when the incident opened; confirmation only
    // upgrades what the operator is looking at.
    expect(confirmed.notices).toEqual([]);
    expect(confirmed.state.incidents["cam-a:weapon"]!.status).toBe("confirmed");
    expect(incidentCameraIds(confirmed.state)).toEqual(["cam-a"]);
  });

  it("retracts the incident when the confirmation overturns it", () => {
    const opened = applyVerdict(createIncidentState(), observation());
    const overturned = applyVerdict(
      opened.state,
      observation({
        timestampMs: 2_000,
        frameId: "frame-2",
        isThreat: false,
        confirmation: "overturned",
      }),
    );

    expect(overturned.notices).toHaveLength(1);
    expect(overturned.notices[0]!.kind).toBe("overturned");
    expect(overturned.notices[0]!.incident.summary).toBe("one person holding a knife");
    expect(overturned.state.incidents["cam-a:weapon"]!.status).toBe("overturned");
    expect(incidentCameraIds(overturned.state)).toEqual([]);
  });

  it("applies a confirmation that carries the triaged frame's own id", () => {
    const opened = applyVerdict(createIncidentState(), observation());

    // The verify pass re-examines the SAME frame the triage verdict came from,
    // so the frame-identity guard must not swallow the confirmation.
    const confirmed = applyVerdict(
      opened.state,
      observation({ timestampMs: 2_000, confirmation: "confirmed" }),
    );

    expect(confirmed.state.incidents["cam-a:weapon"]!.status).toBe("confirmed");
  });

  it("stays inert when the same confirmation is replayed", () => {
    const opened = applyVerdict(createIncidentState(), observation());
    const first = applyVerdict(
      opened.state,
      observation({ timestampMs: 2_000, isThreat: false, confirmation: "overturned" }),
    );
    expect(first.notices).toHaveLength(1);

    const replay = applyVerdict(
      first.state,
      observation({ timestampMs: 3_000, isThreat: false, confirmation: "overturned" }),
    );

    // A replayed retraction must not retract twice.
    expect(replay.notices).toEqual([]);
    expect(replay.state.incidents["cam-a:weapon"]!.status).toBe("overturned");
  });

  it("ignores a confirmation that has no incident to update", () => {
    const outcome = applyVerdict(
      createIncidentState(),
      observation({ frameId: "frame-lonely", confirmation: "confirmed" }),
    );

    expect(outcome.notices).toEqual([]);
    expect(outcome.state.incidents).toEqual({});
  });
});

describe("incident — identity and isolation", () => {
  const clean = (
    cameraId: string,
    timestampMs: number,
    frameId: string,
  ): IncidentObservation =>
    observation({ cameraId, isThreat: false, threatType: "none", timestampMs, frameId });

  it("tracks a different threat type on the same camera separately", () => {
    let outcome = applyVerdict(createIncidentState(), observation());
    outcome = applyVerdict(
      outcome.state,
      observation({
        timestampMs: 2_000,
        frameId: "frame-2",
        threatType: "fight",
        summary: "two people fighting",
      }),
    );

    expect(outcome.notices).toHaveLength(1);
    expect(outcome.notices[0]!.incident.id).toBe("cam-a:fight");
    expect(Object.keys(outcome.state.incidents).sort()).toEqual(["cam-a:fight", "cam-a:weapon"]);
  });

  it("counts a clean frame against every open incident on that camera", () => {
    let outcome = applyVerdict(createIncidentState(), observation());
    outcome = applyVerdict(
      outcome.state,
      observation({ timestampMs: 2_000, frameId: "frame-2", threatType: "fight" }),
    );
    outcome = applyVerdict(outcome.state, clean("cam-a", 5_000, "neg-1"));
    outcome = applyVerdict(outcome.state, clean("cam-a", 8_000, "neg-2"));
    outcome = applyVerdict(outcome.state, clean("cam-a", 11_000, "neg-3"));

    expect(outcome.notices.map((notice) => notice.incident.id).sort()).toEqual([
      "cam-a:fight",
      "cam-a:weapon",
    ]);
    expect(incidentCameraIds(outcome.state)).toEqual([]);
  });

  it("never leaks state between cameras", () => {
    const first = applyVerdict(createIncidentState(), observation());
    const other = applyVerdict(
      first.state,
      observation({ cameraId: "cam-b", cameraLabel: "Back Gate", frameId: "frame-b1" }),
    );
    expect(other.notices[0]!.incident.id).toBe("cam-b:weapon");

    let outcome = applyVerdict(other.state, clean("cam-b", 4_000, "b-neg-1"));
    outcome = applyVerdict(outcome.state, clean("cam-b", 7_000, "b-neg-2"));
    outcome = applyVerdict(outcome.state, clean("cam-b", 10_000, "b-neg-3"));

    expect(outcome.state.incidents["cam-a:weapon"]!.status).toBe("open");
    expect(outcome.state.incidents["cam-b:weapon"]!.status).toBe("resolved");
    expect(incidentCameraIds(outcome.state)).toEqual(["cam-a"]);
  });

  it("never alerts twice for the same frame, even long after the throttle window", () => {
    const opened = applyVerdict(createIncidentState(), observation());
    const replayed = applyVerdict(opened.state, observation({ timestampMs: 60_000 }));

    expect(replayed.notices).toEqual([]);
    expect(replayed.state.incidents["cam-a:weapon"]!.notifyCount).toBe(1);
    expect(replayed.state.incidents["cam-a:weapon"]!.lastSeenAt).toBe(1_000);
  });

  it("counts a repeated clean frame once", () => {
    const opened = applyVerdict(createIncidentState(), observation());
    let outcome = applyVerdict(opened.state, clean("cam-a", 4_000, "neg-same"));
    outcome = applyVerdict(outcome.state, clean("cam-a", 7_000, "neg-same"));
    outcome = applyVerdict(outcome.state, clean("cam-a", 10_000, "neg-same"));

    // One clean frame replayed is still one clean frame, so nothing resolves.
    expect(outcome.notices).toEqual([]);
    expect(outcome.state.incidents["cam-a:weapon"]!.status).toBe("open");
  });
});
