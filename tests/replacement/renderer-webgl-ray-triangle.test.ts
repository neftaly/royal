import { describe, expect, it } from "vitest";
import { rayTriangleInto } from "../../packages/renderer-webgl/src/math/ray-triangle";

describe("shared ray triangle calculation", () => {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);

  it("preserves analytic barycentrics and distance for a non-unit ray", () => {
    const hit = { distance: 0, u: 0, v: 0 };
    expect(
      rayTriangleInto(
        hit,
        positions,
        0,
        1,
        2,
        { origin: [0.5, 1, 6], direction: [0, 0, -2] },
        1,
        false,
      ),
    ).toBe(true);
    expect(hit).toEqual({ distance: 3, u: 0.25, v: 0.5 });
  });

  it("allows footprint extrapolation while picking rejects outside hits and backfaces", () => {
    const hit = { distance: 0, u: 0, v: 0 };
    const ray = { origin: [3, 1, 6] as const, direction: [0, 0, -2] as const };
    expect(rayTriangleInto(hit, positions, 0, 1, 2, ray, 1, true)).toBe(false);
    expect(rayTriangleInto(hit, positions, 0, 1, 2, ray, 1, true, false)).toBe(true);
    expect(hit).toEqual({ distance: 3, u: 1.5, v: 0.5 });
    const inside = { ...ray, origin: [0.5, 1, 6] as const };
    expect(rayTriangleInto(hit, positions, 0, 1, 2, inside, -1, false)).toBe(false);
    expect(rayTriangleInto(hit, positions, 0, 1, 2, inside, -1, true)).toBe(true);
    expect(
      rayTriangleInto(hit, positions, 0, 1, 2, { ...inside, direction: [1, 0, 0] }, 1, true),
    ).toBe(false);
  });
});
