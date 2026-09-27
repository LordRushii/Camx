import { describe, expect, it } from "vitest";
import { scaledDims } from "../downscale";

describe("scaledDims", () => {
  it("keeps dimensions under the max on both axes (landscape)", () => {
    expect(scaledDims(1920, 1080, 768)).toEqual({ w: 768, h: 432 });
  });

  it("keeps dimensions under the max (portrait)", () => {
    expect(scaledDims(1080, 1920, 768)).toEqual({ w: 432, h: 768 });
  });

  it("never upscales small frames", () => {
    expect(scaledDims(320, 240, 768)).toEqual({ w: 320, h: 240 });
  });

  it("handles exact-size frames", () => {
    expect(scaledDims(768, 768, 768)).toEqual({ w: 768, h: 768 });
  });

  it("guards against zero dimensions", () => {
    expect(scaledDims(0, 0, 768)).toEqual({ w: 0, h: 0 });
  });
});
