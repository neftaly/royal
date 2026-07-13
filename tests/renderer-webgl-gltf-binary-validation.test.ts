import { describe, expect, it } from "vitest";
import { readGltfFloatAccessor, readGltfIndices } from "../packages/renderer-webgl/src/gltf/accessors";
import { gltfBufferViewBytes, loadGltfBuffers, parseGltfDocumentBytes } from "../packages/renderer-webgl/src/gltf/io";
import type { GltfDocument } from "../packages/renderer-webgl/src/gltf/schema";

const bytes = (...values: readonly number[]): ArrayBuffer => new Uint8Array(values).buffer as ArrayBuffer;

const GLB_MAGIC = 0x46546C67;
const GLB_JSON = 0x4E4F534A;
const GLB_BIN = 0x004E4942;

const glb = (chunks: readonly { readonly bytes: ArrayBuffer; readonly type: number }[]): ArrayBuffer => {
  const byteLength = 12 + chunks.reduce((length, chunk) => length + 8 + chunk.bytes.byteLength, 0);
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, byteLength, true);
  let offset = 12;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.bytes.byteLength, true);
    view.setUint32(offset + 4, chunk.type, true);
    new Uint8Array(buffer, offset + 8, chunk.bytes.byteLength).set(new Uint8Array(chunk.bytes));
    offset += 8 + chunk.bytes.byteLength;
  }

  return buffer;
};

const jsonChunk = (): ArrayBuffer => {
  const encoded = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
  const padded = new Uint8Array(Math.ceil(encoded.byteLength / 4) * 4);
  padded.fill(0x20);
  padded.set(encoded);
  return padded.buffer;
};

describe("glTF binary validation", () => {
  it("parses a first JSON chunk while preserving an optional BIN and ignoring unknown chunks", () => {
    const binary = bytes(1, 2, 3, 4);
    const payload = parseGltfDocumentBytes("asset.glb", glb([
      { bytes: jsonChunk(), type: GLB_JSON },
      { bytes: bytes(9, 8, 7, 6), type: 0x12345678 },
      { bytes: binary, type: GLB_BIN },
    ]));

    expect(payload.document).toMatchObject({ asset: { version: "2.0" } });
    expect([...new Uint8Array(payload.binaryChunk!)]).toEqual([1, 2, 3, 4]);
  });

  it("rejects truncated GLB headers and mismatched declared lengths", () => {
    expect(() => parseGltfDocumentBytes("asset.glb", new ArrayBuffer(11))).toThrow(/header length/);

    const trailing = glb([{ bytes: jsonChunk(), type: GLB_JSON }]);
    const extended = new Uint8Array(trailing.byteLength + 4);
    extended.set(new Uint8Array(trailing));
    expect(() => parseGltfDocumentBytes("asset.glb", extended.buffer)).toThrow(/Invalid GLB length/);

    const truncated = trailing.slice(0, trailing.byteLength - 4);
    expect(() => parseGltfDocumentBytes("asset.glb", truncated)).toThrow(/Invalid GLB length/);
  });

  it("rejects incomplete and unaligned GLB chunks", () => {
    const incomplete = glb([{ bytes: jsonChunk(), type: GLB_JSON }]);
    const withTrailingBytes = new Uint8Array(incomplete.byteLength + 4);
    withTrailingBytes.set(new Uint8Array(incomplete));
    new DataView(withTrailingBytes.buffer).setUint32(8, withTrailingBytes.byteLength, true);
    expect(() => parseGltfDocumentBytes("asset.glb", withTrailingBytes.buffer)).toThrow(/trailing chunk header/);

    const unaligned = glb([{ bytes: bytes(1, 2, 3), type: GLB_JSON }]);
    expect(() => parseGltfDocumentBytes("asset.glb", unaligned)).toThrow(/not 4-byte aligned/);
  });

  it("rejects GLBs whose JSON chunk is not first or occurs more than once", () => {
    expect(() => parseGltfDocumentBytes("asset.glb", glb([
      { bytes: bytes(1, 2, 3, 4), type: GLB_BIN },
      { bytes: jsonChunk(), type: GLB_JSON },
    ]))).toThrow(/JSON chunk must be first/);
    expect(() => parseGltfDocumentBytes("asset.glb", glb([
      { bytes: jsonChunk(), type: GLB_JSON },
      { bytes: jsonChunk(), type: GLB_JSON },
    ]))).toThrow(/multiple JSON chunks/);
  });

  it("rejects more than one GLB BIN chunk", () => {
    expect(() => parseGltfDocumentBytes("asset.glb", glb([
      { bytes: jsonChunk(), type: GLB_JSON },
      { bytes: bytes(1, 2, 3, 4), type: GLB_BIN },
      { bytes: bytes(5, 6, 7, 8), type: GLB_BIN },
    ]))).toThrow(/multiple BIN chunks/);
  });

  it("rejects missing and out-of-range bufferView storage", () => {
    expect(() => gltfBufferViewBytes({}, [], 3)).toThrow(/bufferView 3 does not exist/);
    expect(() => gltfBufferViewBytes({ bufferViews: [{ buffer: 2, byteLength: 1 }] }, [], 0))
      .toThrow(/bufferView 0 references missing buffer 2/);
    expect(() => gltfBufferViewBytes({ bufferViews: [{ byteLength: 3, byteOffset: 2 }] }, [bytes(1, 2, 3)], 0))
      .toThrow(/bufferView 0 range \[2, 5\) exceeds buffer 0 byteLength 3/);
  });

  it("rejects URI-less non-GLB buffers and declared lengths exceeding available bytes", async () => {
    await expect(loadGltfBuffers("asset.gltf", { buffers: [{ byteLength: 4 }] }, undefined))
      .rejects.toThrow(/asset\.gltf.*buffer 0 has no URI and no GLB binary chunk/);
    await expect(loadGltfBuffers(
      "asset.gltf",
      { buffers: [{ byteLength: 3, uri: "data:application/octet-stream;base64,AQI=" }] },
      undefined,
    )).rejects.toThrow(/buffer 0 declares 3 bytes, but only 2 bytes are available/);
    await expect(loadGltfBuffers("asset.glb", { buffers: [{ byteLength: 3 }] }, bytes(1, 2)))
      .rejects.toThrow(/buffer 0 declares 3 bytes, but only 2 bytes are available/);
  });

  it("rejects missing accessors, bufferViews, and buffers with accessor context", () => {
    expect(() => readGltfFloatAccessor({}, [], 4)).toThrow(/glTF accessor 4 does not exist/);
    expect(() => readGltfFloatAccessor({
      accessors: [{ bufferView: 2, componentType: 5126, count: 1, type: "SCALAR" }],
    }, [], 0)).toThrow(/glTF accessor 0 references missing bufferView 2/);
    expect(() => readGltfIndices({
      accessors: [{ bufferView: 0, componentType: 5123, count: 1, type: "SCALAR" }],
      bufferViews: [{ buffer: 1, byteLength: 2 }],
    }, [], 0)).toThrow(/glTF accessor 0 bufferView 0 references missing buffer 1/);
  });

  it("rejects accessor ranges and malformed strides before reading", () => {
    const document: GltfDocument = {
      accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: "VEC2" }],
      bufferViews: [{ byteLength: 12 }],
    };
    expect(() => readGltfFloatAccessor(document, [new ArrayBuffer(12)], 0))
      .toThrow(/accessor 0 byte range \[0, 16\) exceeds bufferView 0 byteLength 12/);

    expect(() => readGltfFloatAccessor({
      ...document,
      bufferViews: [{ byteLength: 24, byteStride: 6 }],
    }, [new ArrayBuffer(24)], 0)).toThrow(/accessor 0 has invalid byteStride 6 for 8-byte elements/);
    expect(() => readGltfFloatAccessor({
      ...document,
      bufferViews: [{ byteLength: 24, byteStride: 10 }],
    }, [new ArrayBuffer(24)], 0)).toThrow(/accessor 0 has invalid byteStride 10 for 8-byte elements/);
  });

  it("preserves zero initialization without a bufferView and applies sparse overlays", () => {
    const buffer = new ArrayBuffer(8);
    new Uint8Array(buffer)[0] = 1;
    new DataView(buffer).setFloat32(4, 7, true);
    const document: GltfDocument = {
      accessors: [{
        componentType: 5126,
        count: 3,
        sparse: {
          count: 1,
          indices: { bufferView: 0, componentType: 5121 },
          values: { bufferView: 1 },
        },
        type: "SCALAR",
      }],
      bufferViews: [
        { byteLength: 1 },
        { byteLength: 4, byteOffset: 4 },
      ],
    };

    expect([...readGltfFloatAccessor(document, [buffer], 0)]).toEqual([0, 7, 0]);
  });

  it("preserves spec-required zero initialization without a bufferView or sparse data", () => {
    expect([...readGltfFloatAccessor({
      accessors: [{ componentType: 5126, count: 3, type: "SCALAR" }],
    }, [], 0)]).toEqual([0, 0, 0]);
    expect(() => readGltfFloatAccessor({
      accessors: [{ byteOffset: 4, componentType: 5126, count: 1, type: "SCALAR" }],
    }, [], 0)).toThrow(/defines byteOffset without a bufferView/);
    expect([...readGltfIndices({
      accessors: [{ componentType: 5123, count: 3, type: "SCALAR" }],
    }, [], 0)]).toEqual([0, 0, 0]);
  });

  it("accounts for glTF matrix column padding when validating and reading accessors", () => {
    const buffer = bytes(1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0);
    const document: GltfDocument = {
      accessors: [{ bufferView: 0, componentType: 5121, count: 1, type: "MAT3" }],
      bufferViews: [{ byteLength: 12 }],
    };

    expect([...readGltfFloatAccessor(document, [buffer], 0)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(() => readGltfFloatAccessor({
      ...document,
      bufferViews: [{ byteLength: 9 }],
    }, [buffer], 0)).toThrow(/accessor 0 byte range \[0, 12\) exceeds bufferView 0 byteLength 9/);
  });

  it("rejects missing and truncated sparse indices and values", () => {
    const accessor = {
      componentType: 5126,
      count: 2,
      sparse: {
        count: 1,
        indices: { bufferView: 0, componentType: 5121 },
        values: { bufferView: 1 },
      },
      type: "SCALAR" as const,
    };
    expect(() => readGltfFloatAccessor({ accessors: [accessor] }, [], 0))
      .toThrow(/accessor 0 sparse values references missing bufferView 1/);
    expect(() => readGltfFloatAccessor({
      accessors: [{ componentType: 5126, count: 1, sparse: { count: 1 }, type: "SCALAR" }],
    } as unknown as GltfDocument, [], 0)).toThrow(/accessor 0 sparse data is missing indices/);
    expect(() => readGltfFloatAccessor({
      accessors: [{
        componentType: 5126,
        count: 1,
        sparse: { count: 1, indices: { bufferView: 0, componentType: 5121 } },
        type: "SCALAR",
      }],
    } as unknown as GltfDocument, [], 0)).toThrow(/accessor 0 sparse data is missing values/);
    expect(() => readGltfFloatAccessor({
      accessors: [accessor],
      bufferViews: [{ byteLength: 0 }, { byteLength: 4 }],
    }, [new ArrayBuffer(4)], 0)).toThrow(/sparse indices byte range \[0, 1\) exceeds bufferView 0 byteLength 0/);
    expect(() => readGltfFloatAccessor({
      accessors: [accessor],
      bufferViews: [{ byteLength: 1 }, { byteLength: 3, byteOffset: 4 }],
    }, [new ArrayBuffer(7)], 0)).toThrow(/sparse values byte range \[0, 4\) exceeds bufferView 1 byteLength 3/);
  });

  it("rejects duplicate and descending sparse indices", () => {
    const sparseDocument = (indices: readonly number[]): GltfDocument => ({
      accessors: [{
        componentType: 5126,
        count: 4,
        sparse: {
          count: indices.length,
          indices: { bufferView: 0, componentType: 5121 },
          values: { bufferView: 1 },
        },
        type: "SCALAR",
      }],
      bufferViews: [
        { byteLength: indices.length },
        { byteLength: indices.length * 4, byteOffset: 4 },
      ],
    });
    const sparseBuffer = (indices: readonly number[]): ArrayBuffer => {
      const buffer = new ArrayBuffer(4 + indices.length * 4);
      new Uint8Array(buffer).set(indices);
      return buffer;
    };

    expect(() => readGltfFloatAccessor(sparseDocument([1, 1]), [sparseBuffer([1, 1])], 0))
      .toThrow(/strictly increasing/);
    expect(() => readGltfFloatAccessor(sparseDocument([2, 1]), [sparseBuffer([2, 1])], 0))
      .toThrow(/strictly increasing/);
    expect([...readGltfFloatAccessor(sparseDocument([0, 2]), [sparseBuffer([0, 2])], 0)])
      .toEqual([0, 0, 0, 0]);
  });

  it("rejects misaligned sparse index-accessor values", () => {
    const buffer = new ArrayBuffer(8);
    expect(() => readGltfIndices({
      accessors: [{
        componentType: 5123,
        count: 1,
        sparse: {
          count: 1,
          indices: { bufferView: 0, componentType: 5121 },
          values: { bufferView: 1 },
        },
        type: "SCALAR",
      }],
      bufferViews: [
        { byteLength: 1 },
        { byteLength: 2, byteOffset: 1 },
      ],
    }, [buffer], 0)).toThrow(/sparse values byteOffset 0 is not aligned to 2 bytes/);
  });
});
