import { describe, expect, it } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import {
  sortSurfacesBackToFront,
  sortTransmissionSurfaces,
} from "../../packages/renderer-webgl/src/surface/surface-depth-order";

type Surface = {
  depthOrder: number;
  drawPacket: Readonly<{ alphaBlend: boolean }>;
  id: number;
  surface: Readonly<{
    worldBounds: Readonly<{
      max: readonly [number, number, number];
      min: readonly [number, number, number];
    }>;
  }>;
};

const item = (id: number, depth: number, alphaBlend = false): Surface => ({
  depthOrder: 0,
  drawPacket: { alphaBlend },
  id,
  surface: {
    worldBounds: {
      max: [0, 0, depth],
      min: [0, 0, depth],
    },
  },
});

describe("surface depth ordering core", () => {
  it("matches a stable ordering oracle across adversarial camera orders", () => {
    let random = 0x12_34_56_78;
    const next = (): number => {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      return random >>> 0;
    };
    const view = identityMat4();
    for (let round = 0; round < 100; round += 1) {
      const count = next() % 65;
      const surfaces = Array.from({ length: count }, (_, id) => item(id, next() % 11));
      const expected = [...surfaces]
        .map((surface, index) => ({ depth: surface.surface.worldBounds.min[2], index, surface }))
        .sort((left, right) => left.depth - right.depth || left.index - right.index)
        .map(({ surface }) => surface.id);

      sortSurfacesBackToFront(surfaces, view);

      expect(surfaces.map((surface) => surface.id)).toEqual(expected);
    }
  });

  it("leaves an already ordered run stable", () => {
    const surfaces = [item(0, -2), item(1, -2), item(2, 1)];

    sortSurfacesBackToFront(surfaces, identityMat4());

    expect(surfaces.map((surface) => surface.id)).toEqual([0, 1, 2]);
  });

  it("draws depth-writing transmission front-to-back before blended transmission", () => {
    const surfaces = [
      item(0, -4, true),
      item(1, -2),
      item(2, -5),
      item(3, -1, true),
      item(4, -2),
    ];

    sortTransmissionSurfaces(surfaces, identityMat4());

    expect(surfaces.map((surface) => surface.id)).toEqual([1, 4, 2, 0, 3]);
  });
});
