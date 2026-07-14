import { describe, expect, it } from "vitest";
import { normalizeLodThresholds } from "../packages/renderer-webgl/src/lod";
import { forEachFuzzCase } from "./fuzz";

describe("canonical LOD preparation", () => {
  it("normalizes arbitrary source hints into complete descending thresholds", () => {
    forEachFuzzCase({ cases: 256, seed: 0x10d0_2026 }, ({ label, random }) => {
      const levelCount = random.int(1, 17);
      const hints = Array.from({ length: random.int(0, levelCount + 5) }, () => random.pick<unknown>([
        random.number(-2, 3),
        Number.NaN,
        Number.POSITIVE_INFINITY,
        null,
        "0.5",
        undefined,
      ]));
      const normalized = normalizeLodThresholds(hints, levelCount);

      expect(normalized, label).toHaveLength(levelCount);
      expect(normalized.every((threshold) => Number.isFinite(threshold)
        && threshold >= 0 && threshold <= 1), label).toBe(true);
      expect(normalized.every((threshold, level) => level === 0
        || threshold <= normalized[level - 1]!), label).toBe(true);
      expect(normalizeLodThresholds(hints, levelCount), label).toEqual(normalized);
    });
  });

  it("uses deterministic Royal defaults independently of a source format", () => {
    expect(normalizeLodThresholds(undefined, 4)).toEqual([0.2, 0.05, 0.0125, 0]);
    expect(normalizeLodThresholds([0.4, 0.8, -1], 4)).toEqual([0.4, 0.4, 0, 0]);
    expect(() => normalizeLodThresholds([], 0)).toThrow(/level count/);
  });
});
