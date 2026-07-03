import { describe, expect, it } from "vitest";
import {
  buildUniformBandTable,
  horizontalRayWinding,
  horizontalRayWindingContribution,
  isInsideByHorizontalWinding,
  lengyelWindingLookupTable,
  quadraticRootContributionCode,
  quadraticWindingClass,
  quadraticWindingShiftCode,
  type QuadraticCurve,
  type Vec2,
} from "./winding";

const lineCurve = (from: Vec2, to: Vec2): QuadraticCurve => ({
  p1: from,
  p2: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
  p3: to,
});

describe("Lengyel quadratic winding prototype", () => {
  it("matches the paper's 0x2E74 root contribution table", () => {
    expect(lengyelWindingLookupTable).toBe(0x2e74);

    for (const row of [
      { className: "A", t1: false, t2: false, y1: 0, y2: 0, y3: 0 },
      { className: "B", t1: true, t2: false, y1: 1, y2: 0, y3: 0 },
      { className: "C", t1: true, t2: true, y1: 0, y2: 1, y3: 0 },
      { className: "D", t1: true, t2: false, y1: 1, y2: 1, y3: 0 },
      { className: "E", t1: false, t2: true, y1: 0, y2: 0, y3: 1 },
      { className: "F", t1: true, t2: true, y1: 1, y2: 0, y3: 1 },
      { className: "G", t1: false, t2: true, y1: 0, y2: 1, y3: 1 },
      { className: "H", t1: false, t2: false, y1: 1, y2: 1, y3: 1 },
    ] as const) {
      const code = quadraticRootContributionCode(row.y1, row.y2, row.y3);
      expect(quadraticWindingClass(row.y1, row.y2, row.y3)).toBe(row.className);
      expect(quadraticWindingShiftCode(row.y1, row.y2, row.y3)).toBe(
        (row.y1 > 0 ? 2 : 0) + (row.y2 > 0 ? 4 : 0) + (row.y3 > 0 ? 8 : 0),
      );
      expect((code & 0b01) !== 0).toBe(row.t1);
      expect((code & 0b10) !== 0).toBe(row.t2);
    }
  });

  it("classifies a simple closed outline by horizontal winding", () => {
    const square: readonly QuadraticCurve[] = [
      lineCurve([0, 0], [1, 0]),
      lineCurve([1, 0], [1, 1]),
      lineCurve([1, 1], [0, 1]),
      lineCurve([0, 1], [0, 0]),
    ];

    expect(horizontalRayWinding(square, [0.5, 0.5])).toBe(-1);
    expect(isInsideByHorizontalWinding(square, [0.5, 0.5])).toBe(true);
    expect(isInsideByHorizontalWinding(square, [-0.25, 0.5])).toBe(false);
    expect(isInsideByHorizontalWinding(square, [1.25, 0.5])).toBe(false);
  });

  it("cancels tangent endpoint roots without a special endpoint branch", () => {
    const arch: QuadraticCurve = {
      p1: [0, 0],
      p2: [0.5, 1],
      p3: [1, 0],
    };

    expect(quadraticRootContributionCode(0, 1, 0)).toBe(0b11);
    expect(horizontalRayWindingContribution(arch, [-0.5, 0])).toBe(0);
  });

  it("builds positive and negative curve orders for uniform bands", () => {
    const curves: readonly QuadraticCurve[] = [
      lineCurve([0, 0], [0, 2]),
      lineCurve([2, 0], [2, 2]),
      lineCurve([1, 2], [3, 2]),
    ];
    const table = buildUniformBandTable(
      curves,
      { xMax: 3, xMin: 0, yMax: 2, yMin: 0 },
      "y",
      { bandCount: 2 },
    );

    expect(table.bandCount).toBe(2);
    expect(table.bands[0]?.positiveOrder.map((ref) => ref.curveIndex)).toEqual([1, 0]);
    expect(table.bands[0]?.negativeOrder.map((ref) => ref.curveIndex)).toEqual([0, 1]);
    expect(table.bands[1]?.positiveOrder.map((ref) => ref.curveIndex)).toEqual([2, 1, 0]);
    expect(table.bands[1]?.negativeOrder.map((ref) => ref.curveIndex)).toEqual([0, 2, 1]);
    expect(table.bands[1]?.splitCoordinate).toBe(2);
  });
});
