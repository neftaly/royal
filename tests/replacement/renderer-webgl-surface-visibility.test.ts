import { perspectiveCamera } from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import {
  identityMat4,
  multiplyMat4Into,
  projectionMat4Into,
  viewMat4Into,
  type Mat4,
} from "../../packages/renderer-webgl/src/math/mat4";
import {
  frustumPlanesInto,
  worldBoundsVisible,
  type WorldBounds,
} from "../../packages/renderer-webgl/src/surface/surface-visibility";

const explicitClipVisibility = (bounds: WorldBounds, matrix: Mat4): boolean => {
  const clip = Array.from({ length: 6 }, () => true);
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
        const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
        const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
        const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
        const distances = [
          clipW + clipX,
          clipW - clipX,
          clipW + clipY,
          clipW - clipY,
          clipW + clipZ,
          clipW - clipZ,
        ];
        for (let plane = 0; plane < 6; plane += 1) {
          if (distances[plane]! >= 0) clip[plane] = false;
        }
      }
    }
  }
  return !clip.some(Boolean);
};

describe("surface frustum selection core", () => {
  it("keeps near-camera and large intersecting bounds while rejecting separated bounds", () => {
    const planes = new Float32Array(24);
    frustumPlanesInto(planes, identityMat4());
    expect(worldBoundsVisible({ min: [-10, -10, -10], max: [10, 10, 10] }, planes)).toBe(true);
    expect(worldBoundsVisible({ min: [0.99, -0.1, -0.1], max: [2, 0.1, 0.1] }, planes)).toBe(true);
    expect(worldBoundsVisible({ min: [2, -0.1, -0.1], max: [3, 0.1, 0.1] }, planes)).toBe(false);
  });

  it("never rejects a clip-visible randomized AABB", () => {
    const camera = perspectiveCamera({
      far: 80,
      fovY: Math.PI / 2.7,
      near: 0.025,
      position: [2, 3, 8],
      rotation: [-0.2, 0.3, 0],
    });
    const viewProjection = multiplyMat4Into(
      identityMat4(),
      projectionMat4Into(identityMat4(), camera, 1280, 720),
      viewMat4Into(identityMat4(), camera),
    );
    const planes = new Float32Array(24);
    frustumPlanesInto(planes, viewProjection);
    let seed = 0x51_f1_5e_ed;
    const random = (): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_00_00_00_00;
    };
    for (let sample = 0; sample < 2_000; sample += 1) {
      const center = [random() * 60 - 30, random() * 40 - 20, random() * 80 - 50];
      const extent = [random() * 8 + 0.001, random() * 8 + 0.001, random() * 8 + 0.001];
      const bounds: WorldBounds = {
        max: [center[0]! + extent[0]!, center[1]! + extent[1]!, center[2]! + extent[2]!],
        min: [center[0]! - extent[0]!, center[1]! - extent[1]!, center[2]! - extent[2]!],
      };
      if (explicitClipVisibility(bounds, viewProjection)) {
        expect(worldBoundsVisible(bounds, planes)).toBe(true);
      }
    }
  });
});
