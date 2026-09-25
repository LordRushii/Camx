import { describe, it, expect } from "vitest";
import { rgbaToInputTensor, postprocessYolo } from "@/lib/detection/yolo";
import { type Detection } from "@/lib/draw";

describe("rgbaToInputTensor", () => {
  it("converts a 2x2 RGBA buffer to a CHW /255 float tensor, ignoring alpha", () => {
    // 4 pixels, HWC RGBA layout
    const rgba = new Uint8ClampedArray([
      10, 20, 30, 255, // pixel 0
      40, 50, 60, 255, // pixel 1
      70, 80, 90, 255, // pixel 2
      100, 110, 120, 255, // pixel 3
    ]);

    const out = rgbaToInputTensor(rgba, 2);

    // [1,3,2,2] => 12 values
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(12);

    // R-plane (indices 0..3)
    expect(out[0]).toBeCloseTo(10 / 255, 6);
    expect(out[1]).toBeCloseTo(40 / 255, 6);
    expect(out[2]).toBeCloseTo(70 / 255, 6);
    expect(out[3]).toBeCloseTo(100 / 255, 6);
    // G-plane (indices 4..7)
    expect(out[4]).toBeCloseTo(20 / 255, 6);
    expect(out[5]).toBeCloseTo(50 / 255, 6);
    expect(out[6]).toBeCloseTo(80 / 255, 6);
    expect(out[7]).toBeCloseTo(110 / 255, 6);
    // B-plane (indices 8..11)
    expect(out[8]).toBeCloseTo(30 / 255, 6);
    expect(out[9]).toBeCloseTo(60 / 255, 6);
    expect(out[10]).toBeCloseTo(90 / 255, 6);
    expect(out[11]).toBeCloseTo(120 / 255, 6);
  });

  it("throws when the buffer length does not match size*size*4", () => {
    expect(() => rgbaToInputTensor(new Uint8ClampedArray(10), 2)).toThrow();
  });
});

// --- postprocessYolo helpers ---

const CHANNELS = 84;
const ANCHORS = 8400;

// Build a zero-filled [1,84,8400] channel-major buffer.
function makeOutput(): Float32Array {
  return new Float32Array(CHANNELS * ANCHORS);
}

// Write one anchor's box + a single class score into the channel-major buffer.
function setAnchor(
  buf: Float32Array,
  anchor: number,
  box: { cx: number; cy: number; w: number; h: number },
  classId: number,
  score: number,
): void {
  buf[0 * ANCHORS + anchor] = box.cx;
  buf[1 * ANCHORS + anchor] = box.cy;
  buf[2 * ANCHORS + anchor] = box.w;
  buf[3 * ANCHORS + anchor] = box.h;
  buf[(classId + 4) * ANCHORS + anchor] = score;
}

describe("postprocessYolo", () => {
  const dims = [1, CHANNELS, ANCHORS] as const;
  const origW = 1280;
  const origH = 720;

  it("returns one correctly scaled detection for a single high-score anchor", () => {
    const buf = makeOutput();
    // class 2 (car), centered box
    setAnchor(buf, 0, { cx: 320, cy: 320, w: 100, h: 200 }, 2, 0.9);

    const dets = postprocessYolo(buf, dims, origW, origH);

    expect(dets.length).toBe(1);
    const d = dets[0] as Detection;
    // xScale = 1280/640 = 2, yScale = 720/640 = 1.125
    expect(d.x1).toBeCloseTo(540, 4); // (320-50)*2
    expect(d.x2).toBeCloseTo(740, 4); // (320+50)*2
    expect(d.y1).toBeCloseTo(247.5, 4); // (320-100)*1.125
    expect(d.y2).toBeCloseTo(472.5, 4); // (320+100)*1.125
    expect(d.class).toBe(2);
    expect(d.confidence).toBeCloseTo(0.9, 6);
  });

  it("suppresses a duplicate overlapping same-class anchor via NMS", () => {
    const buf = makeOutput();
    setAnchor(buf, 0, { cx: 320, cy: 320, w: 100, h: 200 }, 2, 0.9);
    // Near-identical overlapping box, same class, lower score -> suppressed
    setAnchor(buf, 1, { cx: 320, cy: 320, w: 100, h: 200 }, 2, 0.8);

    const dets = postprocessYolo(buf, dims, origW, origH);

    expect(dets.length).toBe(1);
    expect((dets[0] as Detection).confidence).toBeCloseTo(0.9, 6);
    expect((dets[0] as Detection).class).toBe(2);
  });

  it("keeps overlapping boxes of different classes (class-aware NMS)", () => {
    const buf = makeOutput();
    setAnchor(buf, 0, { cx: 320, cy: 320, w: 100, h: 200 }, 2, 0.9);
    setAnchor(buf, 1, { cx: 320, cy: 320, w: 100, h: 200 }, 5, 0.8);

    const dets = postprocessYolo(buf, dims, origW, origH);

    expect(dets.length).toBe(2);
    expect(dets.map((d) => d.class).sort()).toEqual([2, 5]);
  });

  it("returns an empty array when all scores are below the confidence threshold", () => {
    const buf = makeOutput();
    setAnchor(buf, 0, { cx: 320, cy: 320, w: 100, h: 200 }, 2, 0.1);
    setAnchor(buf, 1, { cx: 100, cy: 100, w: 20, h: 20 }, 7, 0.24);

    const dets = postprocessYolo(buf, dims, origW, origH);

    expect(dets.length).toBe(0);
  });

  it("caps the number of detections at 100", () => {
    const buf = makeOutput();
    // 150 non-overlapping tiny boxes -> all survive NMS, cap applies.
    const size = 640;
    for (let i = 0; i < 150; i++) {
      const cx = (i % 40) * 15 + 5;
      const cy = Math.floor(i / 40) * 15 + 5;
      setAnchor(buf, i, { cx, cy, w: 4, h: 4 }, i % 80, 0.9);
    }

    const dets = postprocessYolo(buf, dims, size, size);

    expect(dets.length).toBe(100);
  });

  it("honors a custom confidence threshold", () => {
    const buf = makeOutput();
    setAnchor(buf, 0, { cx: 320, cy: 320, w: 100, h: 200 }, 2, 0.3);

    expect(postprocessYolo(buf, dims, origW, origH, { confThreshold: 0.5 }).length).toBe(0);
    expect(postprocessYolo(buf, dims, origW, origH, { confThreshold: 0.2 }).length).toBe(1);
  });
});
