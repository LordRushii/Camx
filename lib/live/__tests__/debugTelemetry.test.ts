import { describe, expect, it } from "vitest";
import { watchResultFromVerdict } from "../debugTelemetry";
import type { Verdict } from "../../budget/verdict";

/**
 * These pin the exact strings the operator already sees in the debug panel —
 * behaviour moved out of CameraCard/monitor page, not invented here.
 */
const threat: Verdict = {
  is_threat: true,
  threat_type: "weapon",
  description: "A person holds a knife toward the camera.",
  confidence: 0.92,
  boxes: [],
};

const clean: Verdict = {
  is_threat: false,
  threat_type: "none",
  description: "",
  confidence: 0.1,
  boxes: [],
};

describe("watchResultFromVerdict", () => {
  it("shows nothing until a verdict has arrived", () => {
    expect(watchResultFromVerdict(null)).toBeNull();
  });

  it("renders a threat with its type and confidence", () => {
    expect(watchResultFromVerdict(threat, { provider: "gemini" })).toEqual({
      isHarm: true,
      description: "[weapon] (conf 92%) A person holds a knife toward the camera.",
    });
  });

  it("renders a clean frame with the provider and gate reasons", () => {
    expect(
      watchResultFromVerdict(clean, {
        provider: "groq",
        degraded: false,
        gateReasons: ["motion", "person", "novel"],
      }),
    ).toEqual({
      isHarm: false,
      description: "LLM: no threat (groq). Gate: motion,person,novel",
    });
  });

  it("marks a degraded answer and reports a closed gate as closed", () => {
    expect(
      watchResultFromVerdict(clean, { provider: null, degraded: true, gateReasons: [] }),
    ).toEqual({
      isHarm: false,
      description: "LLM: no threat (—, degraded). Gate: closed",
    });
  });
});
