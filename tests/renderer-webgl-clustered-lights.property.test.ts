import { describe, expect, it } from "vitest";
import { perspectiveCamera } from "../packages/renderer-core/src/camera";
import { projectionMat4, viewMat4 } from "../packages/renderer-webgl/src/math/mat4";
import { buildClusterGrid } from "../packages/renderer-webgl/src/webgl/clustered-lights";
import type { SurfacePointLight } from "../packages/renderer-webgl/src/webgl/lights";
import { forEachFuzzCase } from "./fuzz";

describe("renderer-webgl clustered Forward+ properties", () => {
  it("builds contiguous valid light-index lists", () => {
    forEachFuzzCase({ cases: 128, seed: 0xf04_4a2d }, ({ label, random }) => {
      const width = random.int(160, 801);
      const height = random.int(120, 601);
      const camera = perspectiveCamera({ far: 100, fovY: 1, near: 0.1, position: [0, 0, 0], rotation: [0, 0, 0] });
      const lights: SurfacePointLight[] = Array.from({ length: random.int(1, 32) }, () => ({
        color: [random.int(1, 500), random.int(1, 500), random.int(1, 500), 1],
        kind: "point",
        position: [random.float() * 12 - 6, random.float() * 8 - 4, -(random.float() * 70 + 1)],
        range: random.float() * 8 + 0.2,
      }));
      const projection = projectionMat4(camera, width, height);
      const grid = buildClusterGrid({ camera, height, lights, projection, view: viewMat4(camera), width });
      let expectedOffset = 0;
      for (let cluster = 0; cluster < grid.clusterCount; cluster += 1) {
        const offset = grid.offsetsAndCounts[cluster * 2]!;
        const count = grid.offsetsAndCounts[cluster * 2 + 1]!;
        if (offset !== expectedOffset) throw new Error(`${label}: non-contiguous offset`);
        for (let entry = 0; entry < count; entry += 1) {
          if (grid.indices[offset + entry]! >= lights.length) throw new Error(`${label}: invalid light index`);
        }
        expectedOffset += count;
      }
      expect(expectedOffset, label).toBe(grid.indexCount);
    });
  });

});
