import {
  boxGeometry,
  linearRgbaFromSrgb,
  mesh,
  metresPerWorldUnit,
  perspectiveCamera,
  royalCoordinateConvention,
  scene,
  unlitMaterial,
  type WorldSize3,
} from "@royal/renderer-core";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("TypeScript-first descriptor immutability", () => {
  it("names Royal's physical and coordinate convention at the public boundary", () => {
    expect(metresPerWorldUnit).toBe(1);
    expect(royalCoordinateConvention).toEqual({
      angleUnit: "radian",
      handedness: "right",
      linearUnit: "metre",
      up: "+y",
      viewForward: "-z",
    });
    expect(linearRgbaFromSrgb([0.5, 0.25, 1, 0.75])).toEqual([
      expect.closeTo(0.214_041, 5),
      expect.closeTo(0.050_876, 5),
      1,
      0.75,
    ]);
  });

  it("copies caller-owned arrays while relying on readonly types instead of runtime freezing", () => {
    const inputSize: [number, number, number] = [1, 2, 3];
    const geometry = boxGeometry(inputSize);
    inputSize[0] = 99;

    expect(geometry.size).toEqual([1, 2, 3]);
    expect(Object.isFrozen(geometry)).toBe(false);
    expect(Object.isFrozen(geometry.size)).toBe(false);
    expectTypeOf(geometry.size).toEqualTypeOf<WorldSize3>();
  });

  it("detaches scene and camera collection inputs without runtime freeze walks", () => {
    const position: [number, number, number] = [0, 0, 3];
    const camera = perspectiveCamera({ position });
    const nodes = [mesh({
      geometry: boxGeometry(1),
      material: unlitMaterial({ color: [1, 1, 1, 1] }),
    })];
    const descriptor = scene({ camera, nodes });
    position[2] = 100;
    nodes.length = 0;

    expect(camera.position).toEqual([0, 0, 3]);
    expect(descriptor.nodes).toHaveLength(1);
    expect(Object.isFrozen(camera)).toBe(false);
    expect(Object.isFrozen(descriptor)).toBe(false);
  });
});
