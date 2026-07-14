import { describe, expect, it } from "vitest";
import {
  assertGltfNodeTraversalSafe,
  estimateGltfPreparationCpu,
} from "../packages/renderer-webgl/src/gltf/preparation-admission";
import type { GltfDocument } from "../packages/renderer-webgl/src/gltf/schema";

describe("glTF preparation admission", () => {
  it("rejects child and MSFT_lod cycles without recursive traversal", () => {
    expect(() => assertGltfNodeTraversalSafe({
      nodes: [{ children: [1] }, { children: [0] }],
    })).toThrow(/child\/MSFT_lod cycle through node 0/i);

    expect(() => assertGltfNodeTraversalSafe({
      nodes: [
        { extensions: { MSFT_lod: { ids: [1] } } },
        { extensions: { MSFT_lod: { ids: [0] } } },
      ],
    })).toThrow(/child\/MSFT_lod cycle through node 0/i);

    expect(() => assertGltfNodeTraversalSafe({
      nodes: [
        { children: [1] },
        { extensions: { MSFT_lod: { ids: [0] } } },
      ],
    })).toThrow(/child\/MSFT_lod cycle through node 0/i);
  });

  it("bounds deep acyclic node graphs before root scene recursion", () => {
    const nodes = Array.from({ length: 513 }, (_, index) =>
      index === 512 ? {} : { children: [index + 1] });
    expect(() => assertGltfNodeTraversalSafe({ nodes }))
      .toThrow(/traversal depth exceeds 512/i);
  });

  it("rejects invalid child and LOD references as malformed input", () => {
    expect(() => assertGltfNodeTraversalSafe({ nodes: [{ children: [2] }] }))
      .toThrow(/child references invalid node 2/i);
    expect(() => assertGltfNodeTraversalSafe({
      nodes: [{ extensions: { MSFT_lod: { ids: [-1] } } }],
    })).toThrow(/MSFT_lod references invalid node -1/i);

    expect(() => estimateGltfPreparationCpu({
      materials: [{ extensions: { MSFT_lod: { ids: [1] } } }],
    })).toThrow(/material 0 MSFT_lod references invalid material 1/i);
  });

  it("estimates source, meshopt, geometry, and workspace bytes before decode", () => {
    const document: GltfDocument = {
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      ],
      buffers: [{ byteLength: 64, uri: "triangle.bin" }],
      bufferViews: [
        {
          buffer: 0,
          byteLength: 36,
          extensions: {
            EXT_meshopt_compression: {
              buffer: 0,
              byteLength: 32,
              byteStride: 12,
              count: 3,
              mode: "ATTRIBUTES",
            },
          },
        },
        { buffer: 0, byteLength: 6, byteOffset: 36 },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      nodes: [{ mesh: 0 }],
      scene: 0,
      scenes: [{ nodes: [0] }],
    };

    expect(estimateGltfPreparationCpu(document)).toEqual({
      assetDecode: 100,
      // 36 position + 36 generated normal + 12 widest retained indices.
      geometry: 84,
      // Geometry preparation plus two simultaneously-live meshopt copies.
      transientPeak: 156,
    });
  });

  it("surfaces huge declared buffers and geometry without allocating them", () => {
    const hugeBuffer = estimateGltfPreparationCpu({
      buffers: [{ byteLength: 400_000_000, uri: "terrain.bin" }],
    });
    expect(hugeBuffer.assetDecode).toBe(400_000_000);

    const hugeGeometry = estimateGltfPreparationCpu({
      accessors: [{ componentType: 5126, count: 50_000_000, type: "VEC3" }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scene: 0,
      scenes: [{ nodes: [0] }],
    });
    expect(hugeGeometry.geometry).toBe(1_200_000_000);
    expect(hugeGeometry.transientPeak).toBe(1_200_000_000);
  });

  it("requires every external buffer to declare its admission size", () => {
    expect(() => estimateGltfPreparationCpu({ buffers: [{ uri: "unknown.bin" }] }))
      .toThrow(/requires a non-negative safe integer byteLength for admission/i);
  });
});
