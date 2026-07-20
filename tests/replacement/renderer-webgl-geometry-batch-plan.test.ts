import { describe, expect, it } from "vitest";
import {
  geometryBatchLayoutByteLength,
  planGeometryBatch,
  planGeometryBatchChunks,
  planGeometryBatchLayout,
  rebaseGeometryIndices,
  validateGeometryIndices,
  writeRebasedGeometryIndices,
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

  it("chunks allocation storage greedily while allowing one oversize primitive", () => {
    const geometries = [
      { indices: new Uint8Array(6), vertexCount: 4 },
      { indices: new Uint8Array(6), vertexCount: 4 },
      { indices: new Uint8Array(6), vertexCount: 20 },
    ];
    expect(planGeometryBatchChunks(geometries, 12, 70)).toEqual([
      { end: 1, start: 0 },
      { end: 2, start: 1 },
      { end: 3, start: 2 },
    ]);
    const oversize = planGeometryBatchLayout([geometries[2]!]);
    expect(geometryBatchLayoutByteLength(oversize, 12)).toBe(246);
  });

  it("writes into larger caller-owned storage without allocating", () => {
    const workspace = new Uint16Array(8);
    writeRebasedGeometryIndices(workspace, new Uint8Array([2, 0, 1]), 300, 3);
    expect([...workspace]).toEqual([302, 300, 301, 0, 0, 0, 0, 0]);
    expect(() => writeRebasedGeometryIndices(
      new Uint8Array(3),
      new Uint8Array([2, 0, 1]),
      300,
      3,
    )).toThrow("exceeds its index storage");
    expect(() => validateGeometryIndices(new Uint8Array([0, 3]), 3))
      .toThrow("index exceeds its vertex range");
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
      const maximumByteLength = random.int(1, 400_001);
      const chunks = planGeometryBatchChunks(geometries, 12, maximumByteLength);
      expect(chunks[0]!.start).toBe(0);
      expect(chunks.at(-1)!.end).toBe(geometries.length);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex]!;
        if (chunkIndex > 0) expect(chunk.start).toBe(chunks[chunkIndex - 1]!.end);
        const chunkPlan = planGeometryBatchLayout(geometries.slice(chunk.start, chunk.end));
        const chunkBytes = geometryBatchLayoutByteLength(chunkPlan, 12);
        if (chunk.end - chunk.start > 1) expect(chunkBytes).toBeLessThanOrEqual(maximumByteLength);
      }
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
