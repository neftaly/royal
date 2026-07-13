import {
  instancedTriangleBinByteLength,
  lodBinByteLength,
  triangleBinByteLength,
} from "./renderer-webgl-scene-gltf-test-runtime";

export const triangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(triangleBinByteLength);

  new Float32Array(buffer, 0, 9).set([
    0, 0.5, 0,
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
  ]);
  new Float32Array(buffer, 36, 9).set([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  new Float32Array(buffer, 72, 6).set([
    0.5, 1.5,
    0, 1,
    1, 1,
  ]);
  new Uint16Array(buffer, 96, 3).set([0, 1, 2]);

  return buffer;
};

export const vertexColorTriangleBin = (): ArrayBuffer => {
  const bytes = new Uint8Array(triangleBinByteLength + 9);
  bytes.set(new Uint8Array(triangleBin()));
  bytes.set([
    255, 0, 0,
    0, 128, 0,
    0, 0, 255,
  ], triangleBinByteLength);

  return bytes.buffer;
};

export const tangentTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(triangleBinByteLength + 48);
  new Uint8Array(buffer).set(new Uint8Array(triangleBin()));
  new Float32Array(buffer, triangleBinByteLength, 12).set([
    1, 0, 0, 1,
    1, 0, 0, 1,
    1, 0, 0, 1,
  ]);

  return buffer;
};

export const multiUvTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(triangleBinByteLength + 24);
  new Uint8Array(buffer).set(new Uint8Array(triangleBin()));
  new Float32Array(buffer, triangleBinByteLength, 6).set([
    0.125, 0.25,
    0.375, 0.5,
    0.625, 0.75,
  ]);

  return buffer;
};

export const meshoptCompressedTriangleBin = (): ArrayBuffer => {
  const bytes = Uint8Array.from([
    160, 0, 0, 0, 1, 60, 0, 0, 0, 129, 255, 0, 0, 0, 1, 48,
    0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 63, 0, 0, 0, 0, 225, 240, 0, 118, 135, 86, 103, 120,
    169, 134, 101, 137, 104, 152, 1, 105, 0, 0,
  ]);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return buffer;
};

export const dracoCompressedTriangleBin = (): ArrayBuffer => {
  const bytes = Uint8Array.from([
    68, 82, 65, 67, 79, 2, 2, 1, 1, 0, 0, 0, 3, 1, 2, 1,
    0, 0, 1, 7, 255, 1, 17, 1, 1, 0, 1, 1, 0, 3, 255, 0,
    0, 0, 0, 0, 1, 0, 0, 1, 0, 9, 3, 0, 0, 2, 1, 1,
    9, 3, 0, 1, 3, 1, 3, 9, 2, 0, 2, 2, 1, 1, 1, 0,
    15, 3, 173, 42, 47, 85, 21, 3, 160, 122, 129, 72, 255, 31, 0, 0,
    0, 0, 0, 0, 0, 255, 63, 0, 0, 0, 0, 0, 191, 0, 0, 0,
    191, 0, 0, 0, 0, 0, 0, 128, 63, 14, 0, 3, 1, 0, 10, 3,
    173, 42, 27, 85, 21, 3, 175, 90, 129, 0, 254, 3, 255, 3, 0, 0,
    255, 1, 0, 0, 10, 1, 1, 1, 0, 13, 3, 173, 42, 39, 85, 21,
    3, 160, 122, 129, 212, 255, 1, 0, 0, 0, 0, 0, 255, 15, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 63, 12,
  ]);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return buffer;
};

export const instancedTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(instancedTriangleBinByteLength);
  new Uint8Array(buffer).set(new Uint8Array(triangleBin()));
  new Float32Array(buffer, triangleBinByteLength, 6).set([
    -0.25, 0, 0,
    0.25, 0, 0,
  ]);
  new Float32Array(buffer, triangleBinByteLength + 24, 6).set([
    1, 1, 1,
    1.25, 1.25, 1.25,
  ]);

  return buffer;
};

export const paddedLength = (byteLength: number): number => Math.ceil(byteLength / 4) * 4;

export const paddedJsonBytes = (value: unknown): Uint8Array => {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(value));
  const bytes = new Uint8Array(paddedLength(jsonBytes.byteLength));
  bytes.set(jsonBytes);
  bytes.fill(0x20, jsonBytes.byteLength);

  return bytes;
};

export const paddedBinaryBytes = (buffer: ArrayBuffer): Uint8Array => {
  const bytes = new Uint8Array(paddedLength(buffer.byteLength));
  bytes.set(new Uint8Array(buffer));

  return bytes;
};

export const glbContainer = (document: unknown, binaryChunk: ArrayBuffer): ArrayBuffer => {
  const jsonBytes = paddedJsonBytes(document);
  const binBytes = paddedBinaryBytes(binaryChunk);
  const totalLength = 12 + 8 + jsonBytes.byteLength + 8 + binBytes.byteLength;
  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  let offset = 0;
  view.setUint32(offset, 0x46546C67, true);
  offset += 4;
  view.setUint32(offset, 2, true);
  offset += 4;
  view.setUint32(offset, totalLength, true);
  offset += 4;
  view.setUint32(offset, jsonBytes.byteLength, true);
  offset += 4;
  view.setUint32(offset, 0x4E4F534A, true);
  offset += 4;
  new Uint8Array(glb, offset, jsonBytes.byteLength).set(jsonBytes);
  offset += jsonBytes.byteLength;
  view.setUint32(offset, binBytes.byteLength, true);
  offset += 4;
  view.setUint32(offset, 0x004E4942, true);
  offset += 4;
  new Uint8Array(glb, offset, binBytes.byteLength).set(binBytes);

  return glb;
};

export const dataUriForBuffer = (buffer: ArrayBuffer): string =>
  `data:application/octet-stream;base64,${Buffer.from(buffer).toString("base64")}`;

export const interleavedTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(102);
  const view = new DataView(buffer);
  const vertices = [
    { normal: [0, 0, 1], position: [0, 0.5, 0], uv: [0.5, 1.5] },
    { normal: [0, 0, 1], position: [-0.5, -0.5, 0], uv: [0, 1] },
    { normal: [0, 0, 1], position: [0.5, -0.5, 0], uv: [1, 1] },
  ];
  for (const [vertexIndex, vertex] of vertices.entries()) {
    const offset = vertexIndex * 32;
    for (const [componentIndex, value] of vertex.position.entries()) {
      view.setFloat32(offset + componentIndex * 4, value, true);
    }
    for (const [componentIndex, value] of vertex.normal.entries()) {
      view.setFloat32(offset + 12 + componentIndex * 4, value, true);
    }
    for (const [componentIndex, value] of vertex.uv.entries()) {
      view.setFloat32(offset + 24 + componentIndex * 4, value, true);
    }
  }
  new Uint16Array(buffer, 96, 3).set([0, 1, 2]);

  return buffer;
};

export const quantizedTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(24);
  new Int16Array(buffer, 0, 9).set([
    0, 32767, 0,
    -32767, -32767, 0,
    32767, -32767, 0,
  ]);
  new Uint16Array(buffer, 18, 3).set([0, 1, 2]);

  return buffer;
};

export const sparseTriangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(40);
  new Uint8Array(buffer, 0, 3).set([0, 1, 2]);
  new Float32Array(buffer, 4, 9).set([
    0, 0.5, 0,
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
  ]);

  return buffer;
};

export const lineBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(24);
  new Float32Array(buffer).set([
    -0.5, 0, 0,
    0.5, 0, 0,
  ]);

  return buffer;
};

export const triangleWithImageBytes = (): ArrayBuffer => {
  const base = triangleBin();
  const buffer = new ArrayBuffer(base.byteLength + 4);
  new Uint8Array(buffer).set(new Uint8Array(base));
  new Uint8Array(buffer, base.byteLength).set([0x89, 0x50, 0x4E, 0x47]);

  return buffer;
};

export const triangleWithBasisuBytes = (): ArrayBuffer => {
  const base = triangleBin();
  const buffer = new ArrayBuffer(base.byteLength + 4);
  new Uint8Array(buffer).set(new Uint8Array(base));
  new Uint8Array(buffer, base.byteLength).set([0xAB, 0x4B, 0x54, 0x58]);

  return buffer;
};

export const lodBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(lodBinByteLength);

  new Float32Array(buffer, 0, 12).set([
    -0.75, -0.75, 0,
    0.75, -0.75, 0,
    0.75, 0.75, 0,
    -0.75, 0.75, 0,
  ]);
  new Uint16Array(buffer, 48, 6).set([0, 1, 2, 0, 2, 3]);
  new Float32Array(buffer, 60, 9).set([
    0, 0.75, 0,
    -0.75, -0.75, 0,
    0.75, -0.75, 0,
  ]);
  new Uint16Array(buffer, 96, 3).set([0, 1, 2]);

  return buffer;
};

export const lodAccessors = () => [
  {
    bufferView: 0,
    componentType: 5126,
    count: 4,
    max: [0.75, 0.75, 0],
    min: [-0.75, -0.75, 0],
    type: "VEC3",
  },
  {
    bufferView: 1,
    componentType: 5123,
    count: 6,
    type: "SCALAR",
  },
  {
    bufferView: 2,
    componentType: 5126,
    count: 3,
    max: [0.75, 0.75, 0],
    min: [-0.75, -0.75, 0],
    type: "VEC3",
  },
  {
    bufferView: 3,
    componentType: 5123,
    count: 3,
    type: "SCALAR",
  },
];

export const lodBufferViews = () => [
  {
    buffer: 0,
    byteLength: 48,
    byteOffset: 0,
    target: 34962,
  },
  {
    buffer: 0,
    byteLength: 12,
    byteOffset: 48,
    target: 34963,
  },
  {
    buffer: 0,
    byteLength: 36,
    byteOffset: 60,
    target: 34962,
  },
  {
    buffer: 0,
    byteLength: 6,
    byteOffset: 96,
    target: 34963,
  },
];
