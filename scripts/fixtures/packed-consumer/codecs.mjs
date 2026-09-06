import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageUrl = import.meta.resolve('@royal/renderer-webgl/package.json');
const { decodeDracoMesh } = await import(new URL('./dist/draco-codec.js', packageUrl).href);
const { MeshoptDecoder } = await import(new URL('./dist/meshopt-codec.js', packageUrl).href);
const [documentPath, bufferPath] = process.argv.slice(2);
const document = JSON.parse(readFileSync(documentPath, 'utf8'));
const primitive = document.meshes[0].primitives[0];
const extension = primitive.extensions.KHR_draco_mesh_compression;
const view = document.bufferViews[extension.bufferView];
const bytes = readFileSync(bufferPath).subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
const mesh = decodeDracoMesh(bytes);
assert.equal(mesh.numPoints(), document.accessors[primitive.attributes.POSITION].count);
await MeshoptDecoder.ready;
const output = new Uint8Array(36);
MeshoptDecoder.decodeGltfBuffer(output, 3, 12, Buffer.from(
  'oAAAAQwAAAD/ATwAAAD/fQAAAAEMAAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgL8AAIC/AAAAAA==',
  'base64',
), 'ATTRIBUTES');
assert.deepEqual([...new Float32Array(output.buffer)], [-1, -1, 0, 1, -1, 0, 0, 1, 0]);
console.log('ok packed standalone Draco and Meshopt codecs');
