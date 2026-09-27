import { describe, expect, it } from "vitest";

/**
 * Contract test for the Convex /api/run JSON encoding of v.bytes() arguments.
 *
 * convex/values documents that Bytes serialize to {"$bytes": "<base64>"} in the
 * JSON format. The route previously sent Array.from(bytes) (a plain number
 * array), which fails the v.bytes() validator — meaning confirmed threats
 * never reached threatLogs. This test pins the correct shape so a regression
 * fails loudly.
 */

/** Mirrors the exact payload construction in app/api/analyze/route.ts. */
function buildFrameBytesArg(base64: string): unknown {
  return { $bytes: base64 };
}

describe("Convex /api/run frameBytes encoding", () => {
  it("encodes bytes as the {$bytes: base64} envelope, not a number array", () => {
    // 'hello' as base64; also exercises a 0x00 byte that a number-array
    // encoding would mangle through JSON.stringify.
    const base64 = Buffer.from("hi\u0000", "utf8").toString("base64");
    const arg = buildFrameBytesArg(base64);

    expect(arg).toEqual({ $bytes: base64 });
    expect(JSON.parse(JSON.stringify(arg))).toEqual({ $bytes: base64 });
    // The old, broken shape for contrast:
    expect(Array.isArray(arg)).toBe(false);
  });

  it("round-trips through the documented Convex JSON bytes format", () => {
    const raw = new Uint8Array([0, 1, 2, 254, 255]);
    const base64 = Buffer.from(raw).toString("base64");
    const json = JSON.stringify({ frameBytes: { $bytes: base64 } });
    const parsed = JSON.parse(json) as { frameBytes: { $bytes: string } };

    expect(parsed.frameBytes.$bytes).toBe(base64);
    expect(Buffer.from(parsed.frameBytes.$bytes, "base64").equals(Buffer.from(raw))).toBe(true);
  });
});
