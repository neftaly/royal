export const makeTriangleFixture = (): {
  readonly bin: ArrayBuffer;
  readonly json: unknown;
} => {
  const position = new Float32Array([0, 1, 0, -1, -1, 0, 1, -1, 0]);
  const normal = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uv = new Float32Array([0.5, 1, 0, 0, 1, 0]);
  const index = new Uint16Array([0, 1, 2]);
  const byteLength =
    position.byteLength +
    normal.byteLength +
    uv.byteLength +
    index.byteLength;
  const bin = new ArrayBuffer(byteLength);
  let byteOffset = 0;

  new Float32Array(bin, byteOffset, position.length).set(position);
  const positionOffset = byteOffset;
  byteOffset += position.byteLength;
  new Float32Array(bin, byteOffset, normal.length).set(normal);
  const normalOffset = byteOffset;
  byteOffset += normal.byteLength;
  new Float32Array(bin, byteOffset, uv.length).set(uv);
  const uvOffset = byteOffset;
  byteOffset += uv.byteLength;
  new Uint16Array(bin, byteOffset, index.length).set(index);
  const indexOffset = byteOffset;

  return {
    bin,
    json: {
      asset: { version: '2.0' },
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
        { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' }
      ],
      buffers: [{ uri: 'triangle.bin' }],
      bufferViews: [
        { buffer: 0, byteLength: position.byteLength, byteOffset: positionOffset },
        { buffer: 0, byteLength: normal.byteLength, byteOffset: normalOffset },
        { buffer: 0, byteLength: uv.byteLength, byteOffset: uvOffset },
        { buffer: 0, byteLength: index.byteLength, byteOffset: indexOffset }
      ],
      images: [{ uri: 'triangle.png' }],
      materials: [{
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 }
        }
      }],
      meshes: [{
        primitives: [{
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
          indices: 3,
          material: 0
        }]
      }],
      nodes: [{ mesh: 0 }],
      scene: 0,
      scenes: [{ nodes: [0] }],
      textures: [{ source: 0 }]
    }
  };
};
