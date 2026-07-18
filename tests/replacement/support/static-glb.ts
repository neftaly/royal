export const staticTriangleDocument = (): Record<string, unknown> => ({
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
  ],
  asset: { version: "2.0" },
  bufferViews: [
    { buffer: 0, byteLength: 36, byteOffset: 0 },
    { buffer: 0, byteLength: 6, byteOffset: 36 },
  ],
  buffers: [{ byteLength: 42 }],
  extensionsRequired: ["KHR_materials_unlit"],
  extensionsUsed: ["KHR_materials_unlit"],
  materials: [{
    extensions: { KHR_materials_unlit: {} },
    pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.8, 1] },
  }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
  nodes: [
    { children: [1], translation: [1, 0, 0] },
    { mesh: 0, translation: [0, 2, 0] },
  ],
  scene: 0,
  scenes: [{ nodes: [0] }],
});

export const staticTriangleGlb = (
  document: Record<string, unknown> = staticTriangleDocument(),
  lastIndex = 2,
): Uint8Array => {
  const binary = new Uint8Array(44);
  new Float32Array(binary.buffer, 0, 9).set([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0,
  ]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, lastIndex]);
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binary.length;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46_54_6c_67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e_4f_53_4a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(json, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binary.length, true);
  view.setUint32(binaryHeader + 4, 0x00_4e_49_42, true);
  bytes.set(binary, binaryHeader + 8);
  return bytes;
};
