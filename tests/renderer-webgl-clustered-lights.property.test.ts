import { describe, expect, it } from "vitest";
import { perspectiveCamera } from "../packages/renderer-core/src/camera";
import { projectionMat4, viewMat4 } from "../packages/renderer-webgl/src/math/mat4";
import { buildClusterGrid } from "../packages/renderer-webgl/src/webgl/clustered-lights";
import {
  commitClusteredLightSnapshot,
  commitClusteredLightView,
  selectClusteredLightResource,
  type ClusteredLightCache,
} from "../packages/renderer-webgl/src/webgl/clustered-light-cache";
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

  it("distinguishes an omitted range from an explicit zero range", () => {
    const camera = perspectiveCamera({ far: 100, fovY: 1, near: 0.1, position: [0, 0, 0], rotation: [0, 0, 0] });
    const projection = projectionMat4(camera, 320, 240);
    const view = viewMat4(camera);
    const unbounded: SurfacePointLight = { color: [10, 10, 10, 1], kind: "point", position: [0, 0, -3] };
    const cache: ClusteredLightCache = new Map();
    const input = {
      createTexture: () => ({} as WebGLTexture), frame: 0, height: 240,
      lights: [unbounded], projection, view, width: 320,
    };
    const first = selectClusteredLightResource(cache, input);
    const grid = buildClusterGrid({ camera, height: 240, lights: input.lights, projection, view, width: 320 });
    const { indices: _indices, offsetsAndCounts: _offsets, ...metadata } = grid;
    commitClusteredLightSnapshot(first.resource, input.lights);
    commitClusteredLightView(first.resource, { frame: 0, grid: metadata, height: 240, projection, view, width: 320 });
    expect(selectClusteredLightResource(cache, input).lightsChanged).toBe(false);
    expect(selectClusteredLightResource(cache, { ...input, lights: [{ ...unbounded, range: 0 }] }).lightsChanged).toBe(true);
  });

  it("reuses one explicit texture triple across many sequential same-frame light sets", () => {
    const camera = perspectiveCamera({ far: 100, fovY: 1, near: 0.1, position: [0, 0, 0], rotation: [0, 0, 0] });
    const projection = projectionMat4(camera, 320, 240);
    const view = viewMat4(camera);
    const cache: ClusteredLightCache = new Map();
    let textureCreates = 0;
    let firstResource: ReturnType<typeof selectClusteredLightResource>["resource"] | undefined;

    for (let draw = 0; draw < 256; draw += 1) {
      const lights: SurfacePointLight[] = [{
        color: [draw + 1, 2, 3, 1],
        kind: "point",
        position: [draw * 0.01, 0, -3],
      }];
      const selected = selectClusteredLightResource(cache, {
        createTexture: () => {
          textureCreates += 1;
          return {} as WebGLTexture;
        },
        frame: 7,
        height: 240,
        lights,
        projection,
        view,
        width: 320,
      });
      firstResource ??= selected.resource;
      expect(selected.resource).toBe(firstResource);
      expect(selected.lightsChanged).toBe(true);
      commitClusteredLightSnapshot(selected.resource, lights);
      const grid = buildClusterGrid({ camera, height: 240, lights, projection, view, width: 320 });
      const { indices: _indices, offsetsAndCounts: _offsets, ...metadata } = grid;
      commitClusteredLightView(selected.resource, {
        frame: 7, grid: metadata, height: 240, projection, view, width: 320,
      });
    }

    expect(textureCreates).toBe(3);
    expect([...cache.values()].flat()).toHaveLength(1);
  });
});
