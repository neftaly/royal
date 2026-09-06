import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const packageUrl = import.meta.resolve('@royal/renderer-webgl/package.json');
const { decodeDracoMesh } = await import(new URL('./dist/draco-codec.js', packageUrl).href);
const { MeshoptDecoder } = await import(new URL('./dist/meshopt-codec.js', packageUrl).href);
// Golden hashes come from the released 0.0.21 / minidraco 0.3.0 decoder.
// Hash every face and decoded attribute, not just counts or positions.
const golden = JSON.parse(readFileSync(new URL('./codec-geometry.json', import.meta.url), 'utf8'));
for (const [name, expected] of Object.entries(golden)) {
  const directory = path.join(process.argv[2], name, 'glTF-Draco');
  const document = JSON.parse(readFileSync(path.join(directory, name + '.gltf'), 'utf8'));
  const buffers = document.buffers.map(buffer => readFileSync(path.join(directory, buffer.uri)));
  const hashes = [];
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) {
    const extension = primitive.extensions?.KHR_draco_mesh_compression;
    if (extension === undefined) continue;
    const view = document.bufferViews[extension.bufferView];
    const decoded = decodeDracoMesh(buffers[view.buffer].subarray(
      view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength,
    ));
    const hash = createHash('sha256');
    const faces = new Uint32Array(decoded.numFaces() * 3);
    for (let index = 0; index < decoded.numFaces(); index++) faces.set(decoded.face(index), index * 3);
    hash.update(new Uint8Array(faces.buffer));
    for (const [semantic, id] of Object.entries(extension.attributes).sort(([a], [b]) => a.localeCompare(b))) {
      hash.update(semantic);
      const values = decoded.getAttributeByUniqueId(id).extractTo(Float32Array, decoded.numPoints());
      hash.update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
    }
    hashes.push(hash.digest('hex'));
  }
  assert.deepEqual(hashes, expected, name + ' decoded geometry must match the released baseline exactly');
}
await MeshoptDecoder.ready;
const output = new Uint8Array(36);
MeshoptDecoder.decodeGltfBuffer(output, 3, 12, Buffer.from(
  'oAAAAQwAAAD/ATwAAAD/fQAAAAEMAAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgL8AAIC/AAAAAA==',
  'base64',
), 'ATTRIBUTES');
assert.deepEqual([...new Float32Array(output.buffer)], [-1, -1, 0, 1, -1, 0, 0, 1, 0]);
console.log('ok packed standalone Draco and Meshopt codecs');
