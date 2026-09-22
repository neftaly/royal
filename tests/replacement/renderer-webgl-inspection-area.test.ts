import { describe, expect, it } from "vitest";
import { reduceInspectionRgba } from "../../packages/renderer-webgl/src/texture/inspection-rgba";
import { inspectionArea } from "../../packages/renderer-webgl/src/texture/inspection-area";

describe("inspection area integration", () => {
  it("includes fractional edges for odd dimensions", () => {
    const result = inspectionArea(5, 1, 2, 1, 1, (x, _y, values) => { values[0] = [0, 0, 100, 200, 200][x]!; });
    expect(Array.from(result)).toEqual([20, 180]);
  });
  it("includes every pixel in a tall, one-pixel-wide image", () => {
    const seen = new Set<number>();
    const result = inspectionArea(1, 1025, 1, 256, 1, (_x, y, values) => { seen.add(y); values[0] = 73; });
    expect(seen.size).toBe(1025);
    for (const value of result) expect(value).toBeCloseTo(73, 10);
  });
  it("preserves the global mean across uneven two-dimensional footprints", () => {
    const result = inspectionArea(7, 11, 3, 4, 1, (x, y, values) => { values[0] = (x + y * 7) % 13; });
    const expected = Array.from({ length: 77 }, (_, i) => i % 13).reduce((a, b) => a + b, 0) / 77;
    expect(result.reduce((a, b) => a + b, 0) / 12).toBeCloseTo(expected, 10);
  });
});


describe("RGBA reduction", () => {
  it.each([[32, 48, 8, 12], [16, 16, 16, 16], [63, 27, 7, 9], [31, 47, 8, 12], [1, 1025, 1, 256]])(
    "matches the weighted reference including alpha for %i x %i to %i x %i", (inputWidth, inputHeight, width, height) => {
      const rgba = new Uint8Array(inputWidth * inputHeight * 4);
      for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 131 + (i >>> 7)) % 256;
      const expected = inspectionArea(inputWidth, inputHeight, width, height, 7, (x, y, values) => {
        const offset = (y * inputWidth + x) * 4, alpha = rgba[offset + 3]! / 255;
        for (let c = 0; c < 3; c++) { values[c] = rgba[offset + c]!; values[c + 3] = rgba[offset + c]! * alpha; }
        values[6] = 255 * (1 - alpha);
      });
      const actual = reduceInspectionRgba({ rgba, inputWidth, inputHeight, width, height });
      expect(actual.transparent).toBe(true);
      expect(actual.reduced).toEqual(expected);
    },
  );
});
