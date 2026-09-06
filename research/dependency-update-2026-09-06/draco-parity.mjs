import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {decodeDracoMesh as oldDecode} from '/tmp/royal-dependency-baseline/renderer-webgl/dist/draco-codec.js';
import {decodeDracoMesh as newDecode} from '/tmp/royal-minidraco-0.5.0/package/dist/index.js';
const root='/home/neftaly/dev/royal/apps/examples-react/public/fixtures/khronos/';
const tasks=[];
for(const name of ['Duck','SunglassesKhronos']) {
 const base=root+name+'/glTF-Draco/';const doc=JSON.parse(readFileSync(base+name+'.gltf'));
 const buffers=doc.buffers.map(b=>readFileSync(base+b.uri));
 for(const mesh of doc.meshes)for(const primitive of mesh.primitives) {
  const ext=primitive.extensions?.KHR_draco_mesh_compression;if(!ext)continue;
  const view=doc.bufferViews[ext.bufferView];
  tasks.push({name,ext,bytes:buffers[view.buffer].subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength)});
 }
}
const extract=(decode,task)=>{
 const m=decode(task.bytes);
 return {points:m.numPoints(),faces:Array.from({length:m.numFaces()},(_,i)=>[...m.face(i)]),attributes:Object.fromEntries(Object.entries(task.ext.attributes).map(([semantic,id])=>[semantic,m.getAttributeByUniqueId(id).extractTo(Float32Array,m.numPoints())]))};
};
const retained=tasks.map(t=>extract(newDecode,t));
for(let round=0;round<3;round++) for(const [i,t] of tasks.entries()) {
 assert.deepEqual(extract(newDecode,t),extract(oldDecode,t));
 assert.deepEqual(retained[i],extract(oldDecode,t));
}
console.log(JSON.stringify({primitives:tasks.length,rounds:3,exactFacesAndAllAttributes:true,retainedOutputStable:true}));
