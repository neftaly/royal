import { describe, expect, it, vi } from "vitest";
import {
  visitPreparedGltfGeometry,
} from "../../packages/renderer-webgl/src/gltf/prepared-geometry";
import type {
  PreparedStaticGltf,
  PreparedStaticGltfPrimitive,
} from "../../packages/renderer-webgl/src/gltf/static-asset";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";

const geometry = {
  bounds: { max: [1, 1, 0], min: [0, 0, 0] },
  indices: new Uint8Array([0, 1, 2]),
  key: "shared-triangle",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
} as const;
const material = {
  baseColor: [1, 1, 1, 1],
  kind: "unlit",
  requiresTextureCoordinates: false,
} as const;
const primitive = (
  overrides: Partial<PreparedStaticGltfPrimitive> = {},
): PreparedStaticGltfPrimitive => ({
  geometry,
  localModel: identityMat4(),
  material,
  ...overrides,
});

describe("prepared glTF geometry visitor", () => {
  it("visits shared highest-detail geometry as borrowed transform batches", () => {
    const transforms = new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1,
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1,
    ]);
    const prepared = {
      alphaMaskTextureAssets: [],
      bounds: { max: [1, 1, 1], min: [0, 0, 0] },
      lights: [],
      nodeCount: 3,
      primitives: [
        primitive({ instanceBatch: { handedness: 1, key: "instances", localModels: transforms } }),
        primitive({ lods: [{ group: 0, level: 1, thresholds: [0.5, 0] }] }),
        primitive({ lods: [{ group: 0, level: 0, thresholds: [0.5, 0] }] }),
      ],
      sceneIndex: 0,
      scenes: [{ index: 0 }],
      textureAssets: [],
      variantNames: [],
    } satisfies PreparedStaticGltf;
    const visitor = vi.fn();

    expect(visitPreparedGltfGeometry(prepared, visitor)).toBe(2);
    expect(visitor).toHaveBeenCalledTimes(2);
    expect(visitor.mock.calls[0]![0]).toMatchObject({
      geometry,
      transformCount: 2,
      transforms,
    });
    expect(visitor.mock.calls[1]![0].geometry).toBe(geometry);
    expect(visitor.mock.calls[1]![0].transformCount).toBe(1);
  });
});
