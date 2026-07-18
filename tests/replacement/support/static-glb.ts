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

export const glbFromDocument = (
  document: Record<string, unknown>,
  binary: Uint8Array,
): Uint8Array => {
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

export const staticTriangleBinary = (lastIndex = 2): Uint8Array => {
  const binary = new Uint8Array(42);
  new Float32Array(binary.buffer, 0, 9).set([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0,
  ]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, lastIndex]);
  return binary;
};

export const staticTriangleGltf = (): Readonly<{
  binary: Uint8Array;
  document: Uint8Array;
}> => {
  const value = staticTriangleDocument();
  value.buffers = [{ byteLength: 42, uri: "triangle.bin" }];
  return {
    binary: staticTriangleBinary(),
    document: new TextEncoder().encode(JSON.stringify(value)),
  };
};

export const staticTriangleGlb = (
  document: Record<string, unknown> = staticTriangleDocument(),
  lastIndex = 2,
): Uint8Array => {
  const binary = new Uint8Array(44);
  binary.set(staticTriangleBinary(lastIndex));
  return glbFromDocument(document, binary);
};

export const staticTexturedTriangleGlb = (
  embeddedImage?: Uint8Array,
  imageUri = "albedo.png",
  format: "avif" | "core" = "core",
): Uint8Array => {
  const document = staticTriangleDocument();
  document.accessors = [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" },
  ];
  document.bufferViews = [
    { buffer: 0, byteLength: 36, byteOffset: 0 },
    { buffer: 0, byteLength: 6, byteOffset: 36 },
    { buffer: 0, byteLength: 24, byteOffset: 44 },
  ];
  const byteLength = 68 + (embeddedImage?.byteLength ?? 0);
  document.buffers = [{ byteLength }];
  if (embeddedImage === undefined) {
    document.images = [{ uri: imageUri }];
  } else {
    const bufferViews = document.bufferViews as unknown[];
    bufferViews.push({ buffer: 0, byteLength: embeddedImage.byteLength, byteOffset: 68 });
    document.images = [{
      bufferView: 3,
      mimeType: format === "avif" ? "image/avif" : "image/png",
    }];
  }
  if (format === "avif") {
    document.extensionsRequired = ["KHR_materials_unlit", "EXT_texture_avif"];
    document.extensionsUsed = ["KHR_materials_unlit", "EXT_texture_avif"];
    document.textures = [{ extensions: { EXT_texture_avif: { source: 0 } } }];
  } else {
    document.textures = [{ source: 0 }];
  }
  document.materials = [{
    extensions: { KHR_materials_unlit: {} },
    pbrMetallicRoughness: {
      baseColorFactor: [0.25, 0.5, 1, 1],
      baseColorTexture: { index: 0 },
    },
  }];
  document.meshes = [{ primitives: [{
    attributes: { POSITION: 0, TEXCOORD_0: 2 },
    indices: 1,
    material: 0,
  }] }];
  const binary = new Uint8Array(byteLength);
  new Float32Array(binary.buffer, 0, 9).set([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0,
  ]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
  new Float32Array(binary.buffer, 44, 6).set([0, 1, 1, 1, 0.5, 0]);
  if (embeddedImage !== undefined) binary.set(embeddedImage, 68);
  return glbFromDocument(document, binary);
};

export const staticInstancedTriangleGlb = (): Uint8Array => {
  const document = staticTriangleDocument();
  document.extensionsRequired = ["KHR_materials_unlit", "EXT_mesh_gpu_instancing"];
  document.extensionsUsed = ["KHR_materials_unlit", "EXT_mesh_gpu_instancing"];
  document.accessors = [
    ...(document.accessors as unknown[]),
    { bufferView: 2, componentType: 5126, count: 2, type: "VEC3" },
    { bufferView: 3, componentType: 5120, count: 2, normalized: true, type: "VEC4" },
    { bufferView: 4, componentType: 5126, count: 2, type: "VEC3" },
  ];
  document.bufferViews = [
    ...(document.bufferViews as unknown[]),
    { buffer: 0, byteLength: 24, byteOffset: 44 },
    { buffer: 0, byteLength: 8, byteOffset: 68 },
    { buffer: 0, byteLength: 24, byteOffset: 76 },
  ];
  document.buffers = [{ byteLength: 100 }];
  const nodes = document.nodes as Array<Record<string, unknown>>;
  nodes[1]!.extensions = {
    EXT_mesh_gpu_instancing: {
      attributes: { ROTATION: 3, SCALE: 4, TRANSLATION: 2 },
    },
  };
  const binary = new Uint8Array(100);
  binary.set(staticTriangleBinary());
  new Float32Array(binary.buffer, 44, 6).set([10, 0, 0, -10, 0, 0]);
  new Int8Array(binary.buffer, 68, 8).set([0, 0, 0, 127, 0, 0, 0, 127]);
  new Float32Array(binary.buffer, 76, 6).set([1, 1, 1, 2, 2, 2]);
  return glbFromDocument(document, binary);
};
