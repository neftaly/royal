import { describe, expect, it } from "vitest";
import {
  planGeometryBatch,
  planGeometryBatchLayout,
  rebaseGeometryIndices,
} from "../../packages/renderer-webgl/src/surface/geometry-batch-plan";
import { forEachFuzzCase } from "../fuzz";

describe("geometry batch planning core", () => {
  it("plans contiguous byte ranges and rebases local indices", () => {
    const geometries = [
      { indices: new Uint8Array([0, 1, 2]), vertexCount: 3 },
      { indices: new Uint16Array([2, 0, 1]), vertexCount: 3 },
    ];
    const plan = planGeometryBatch(geometries);
    expect(plan).toMatchObject({
      indexBytes: 1,
      indexCount: 6,
      ranges: [
        { indexByteOffset: 0, indexCount: 3, vertexOffset: 0 },
        { indexByteOffset: 3, indexCount: 3, vertexOffset: 3 },
      ],
      vertexCount: 6,
    });
    expect([...plan.indices]).toEqual([0, 1, 2, 5, 3, 4]);
  });

  it("selects the smallest legal shared index representation at boundaries", () => {
    expect(planGeometryBatch([{
      indices: new Uint16Array([255]),
      vertexCount: 256,
    }]).indexBytes).toBe(1);
    expect(planGeometryBatch([{
      indices: new Uint16Array([256]),
      vertexCount: 257,
    }]).indexBytes).toBe(2);
    expect(planGeometryBatch([
      { indices: new Uint16Array([0]), vertexCount: 65_536 },
      { indices: new Uint8Array([0]), vertexCount: 1 },
    ]).indexBytes).toBe(4);
  });

  it("separates capacity planning from bounded admission uploads", () => {
    const layout = planGeometryBatchLayout([
      { indices: new Uint8Array([0, 1, 2]), vertexCount: 3 },
      { indices: new Uint8Array([2, 0, 1]), vertexCount: 300 },
    ]);
    expect(layout).toEqual({
      indexBytes: 2,
      indexCount: 6,
      ranges: [
        { indexByteOffset: 0, indexCount: 3, vertexOffset: 0 },
        { indexByteOffset: 6, indexCount: 3, vertexOffset: 3 },
      ],
      vertexCount: 303,
    });
    const admitted = rebaseGeometryIndices(
      new Uint8Array([2, 0, 1]),
      layout.ranges[1]!.vertexOffset,
      layout.indexBytes,
      300,
    );
    expect(admitted).toBeInstanceOf(Uint16Array);
    expect([...admitted]).toEqual([5, 3, 4]);
  });

  it("matches a simple reference across randomized compatible batches", () => {
    forEachFuzzCase({ cases: 500, seed: 0x51_7a_2c_09 }, ({ random }) => {
      const geometryCount = random.int(1, 13);
      const geometries = Array.from({ length: geometryCount }, () => {
        const vertexCount = random.int(1, 20_001);
        const indexCount = random.int(1, 41);
        const indices = new Uint32Array(indexCount);
        for (let index = 0; index < indexCount; index += 1) {
          indices[index] = random.int(0, vertexCount);
        }
        return { indices, vertexCount };
      });
      const plan = planGeometryBatch(geometries);
      const reference: number[] = [];
      let vertexOffset = 0;
      let outputOffset = 0;
      for (let index = 0; index < geometries.length; index += 1) {
        const geometry = geometries[index]!;
        const range = plan.ranges[index]!;
        expect(range).toEqual({
          indexByteOffset: outputOffset * plan.indexBytes,
          indexCount: geometry.indices.length,
          vertexOffset,
        });
        for (const value of geometry.indices) reference.push(vertexOffset + value);
        outputOffset += geometry.indices.length;
        vertexOffset += geometry.vertexCount;
      }
      expect([...plan.indices]).toEqual(reference);
    });
  });
});
