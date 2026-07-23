import { describe, expect, it } from "vitest";
import type { PreparedStaticGltf } from "../../packages/renderer-webgl/src/gltf/static-asset";
import { preparedStaticGltfTransferBuffers } from "../../packages/renderer-webgl/src/gltf/static-transfer";

const matrix = () => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

describe("prepared static glTF transfer ownership", () => {
  it("enumerates canonical typed storage exactly once without reflecting the artifact graph", () => {
    const sharedGeometry = new ArrayBuffer(384);
    const indices = new Uint16Array(sharedGeometry, 0, 3);
    const positions = new Float32Array(sharedGeometry, 16, 9);
    const normals = new Float32Array(sharedGeometry, 64, 9);
    const colors = new Float32Array(sharedGeometry, 112, 12);
    const tangents = new Float32Array(sharedGeometry, 160, 12);
    const textureCoordinates0 = new Float32Array(sharedGeometry, 208, 6);
    const textureCoordinates1 = new Float32Array(sharedGeometry, 232, 6);
    const localModel = matrix();
    const instanceModels = new Float32Array(32);
    const lightModel = matrix();
    const embeddedStorage = new ArrayBuffer(32);
    const embeddedBytes = new Uint8Array(embeddedStorage, 8, 12);
    const fallbackStorage = new ArrayBuffer(16);
    const fallbackBytes = new Uint8Array(fallbackStorage, 4, 8);
    const prepared: PreparedStaticGltf = {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      lights: [{
        color: [1, 1, 1],
        innerConeAngle: 0,
        intensity: 1,
        kind: "point",
        localModel: lightModel,
        outerConeAngle: Math.PI / 4,
        range: 0,
      }],
      nodeCount: 1,
      primitives: [{
        geometry: {
          bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
          colors,
          indices,
          key: "mesh:0",
          normals,
          positions,
          tangents,
          textureCoordinates0,
          textureCoordinates1,
        },
        instanceBatch: { handedness: 1, key: "instances:0", localModels: instanceModels },
        localModel,
        material: {
          baseColor: [1, 1, 1, 1],
          kind: "unlit",
          requiresTextureCoordinates: false,
        },
      }],
      sceneIndex: 0,
      scenes: [{ index: 0 }],
      textureAssets: [{
        bytes: embeddedBytes,
        contentKey: "embedded:0",
        fallback: {
          bytes: fallbackBytes,
          contentKey: "embedded:1",
          kind: "embedded-asset",
          label: "embedded fallback",
          mimeType: "image/png",
        },
        kind: "embedded-asset",
        label: "embedded image",
        mimeType: "image/svg+xml",
        sourceEncoding: "svg",
      }],
      variantNames: [],
    };

    expect(new Set(preparedStaticGltfTransferBuffers(prepared))).toEqual(new Set([
      sharedGeometry,
      instanceModels.buffer,
      embeddedStorage,
      fallbackStorage,
    ]));
  });

  it("does not invent transfer storage for external texture recipes", () => {
    const prepared: PreparedStaticGltf = {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      lights: [],
      nodeCount: 0,
      primitives: [],
      rootExtras: { application: { revision: 3 } },
      sceneIndex: 0,
      scenes: [{ index: 0 }],
      textureAssets: [{ kind: "asset", src: "/texture.avif" }],
      variantNames: [],
    };
    expect(preparedStaticGltfTransferBuffers(prepared)).toEqual([]);
  });
});
