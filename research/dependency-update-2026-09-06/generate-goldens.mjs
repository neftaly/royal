import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {decodeDracoMesh} from '/tmp/royal-dependency-baseline/renderer-webgl/dist/draco-codec.js';
const root='/home/neftaly/dev/royal/apps/examples-react/public/fixtures/khronos/';const golden={};
for(const name of ['Duck','SunglassesKhronos']){
 const base=root+name+'/glTF-Draco/';const doc=JSON.parse(readFileSync(base+name+'.gltf'));const buffers=doc.buffers.map(b=>readFileSync(base+b.uri));const hashes=[];
 for(const mesh of doc.meshes)for(const p of mesh.primitives){
  const ext=p.extensions?.KHR_draco_mesh_compression;if(!ext)continue;const v=doc.bufferViews[ext.bufferView];
  const m=decodeDracoMesh(buffers[v.buffer].subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength));
  const hash=createHash('sha256');const faces=new Uint32Array(m.numFaces()*3);
  for(let i=0;i<m.numFaces();i++)faces.set(m.face(i),i*3);
  hash.update(new Uint8Array(faces.buffer));
  for(const [semantic,id] of Object.entries(ext.attributes).sort(([a],[b])=>a.localeCompare(b))){
   hash.update(semantic);const a=m.getAttributeByUniqueId(id).extractTo(Float32Array,m.numPoints());hash.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
  }
  hashes.push(hash.digest('hex'));
 }
 golden[name]=hashes;
}
writeFileSync('/home/neftaly/dev/royal/scripts/fixtures/packed-consumer/codec-geometry.json',JSON.stringify(golden,null,2)+'\n');
