import { describe, expect, it } from "vitest";
import { parseVerdict } from "../verdict";

describe("parseVerdict", () => {
  it("parses a valid positive verdict", () => {
    const v = parseVerdict(
      JSON.stringify({
        is_threat: true,
        threat_type: "weapon",
        description: "A person is pointing a handgun at another person.",
        confidence: 0.86,
        boxes: [{ label: "weapon", x1: 0.41, y1: 0.32, x2: 0.55, y2: 0.48 }],
      }),
    );
    expect(v).toEqual({
      is_threat: true,
      threat_type: "weapon",
      description: "A person is pointing a handgun at another person.",
      confidence: 0.86,
      boxes: [{ label: "weapon", x1: 0.41, y1: 0.32, x2: 0.55, y2: 0.48 }],
    });
  });

  it("strips markdown code fences before parsing", () => {
    const v = parseVerdict(
      '```json\n{"is_threat": false, "threat_type": "none", "description": "", "confidence": 0.1}\n```',
    );
    expect(v.is_threat).toBe(false);
    expect(v.threat_type).toBe("none");
  });

  it("enforces invariants: is_threat=false forces threat_type none", () => {
    const v = parseVerdict(
      '{"is_threat": false, "threat_type": "weapon", "description": "x", "confidence": 0.5}',
    );
    expect(v.is_threat).toBe(false);
    expect(v.threat_type).toBe("none");
  });

  it("enforces invariants: is_threat=true with threat_type none becomes other", () => {
    const v = parseVerdict(
      '{"is_threat": true, "threat_type": "none", "description": "something", "confidence": 0.9}',
    );
    expect(v.is_threat).toBe(true);
    expect(v.threat_type).toBe("other");
  });

  it("enforces invariants: is_threat=true requires non-empty description", () => {
    expect(() =>
      parseVerdict('{"is_threat": true, "threat_type": "fight", "description": "  "}'),
    ).toThrow();
  });

  it("coerces unknown threat_type to other", () => {
    const v = parseVerdict(
      '{"is_threat": true, "threat_type": "alien-invasion", "description": "ufo", "confidence": 1}',
    );
    expect(v.threat_type).toBe("other");
  });

  it("clamps confidence into 0..1 and defaults missing confidence to 0.5", () => {
    const high = parseVerdict('{"is_threat": false, "confidence": 42}');
    expect(high.confidence).toBe(1);
    const low = parseVerdict('{"is_threat": false, "confidence": -3}');
    expect(low.confidence).toBe(0);
    const missing = parseVerdict('{"is_threat": false}');
    expect(missing.confidence).toBe(0.5);
  });

  it("drops malformed boxes instead of failing the verdict", () => {
    const v = parseVerdict(
      '{"is_threat": true, "threat_type": "weapon", "description": "gun", "confidence": 0.8, "boxes": [{"label": "weapon", "x1": 0.1, "y1": 0.1, "x2": 0.2, "y2": 0.2}, {"nope": true}, "junk"]}',
    );
    expect(v.boxes).toHaveLength(1);
  });

  it("returns a safe none-verdict on unparseable garbage", () => {
    const v = parseVerdict("the model said some prose without any json {");
    expect(v).toEqual({
      is_threat: false,
      threat_type: "none",
      description: "",
      confidence: 0,
      boxes: [],
    });
  });

  it("accepts the legacy worker shape {isHarm, description} via adapter", () => {
    const v = parseVerdict('{"isHarm": true, "description": "Weapon visible"}');
    expect(v.is_threat).toBe(true);
    expect(v.threat_type).toBe("other");
    expect(v.description).toBe("Weapon visible");
    const neg = parseVerdict('{"isHarm": false}');
    expect(neg.is_threat).toBe(false);
    expect(neg.threat_type).toBe("none");
  });
});
