import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const require=createRequire('/home/neftaly/dev/probability/apps/play/package.json');
const {chromium}=require('@playwright/test');
const dir='/tmp/royal-codec-browser/dist';
copyFileSync('/tmp/royal-dependency-baseline/renderer-webgl/dist/draco-codec.js',dir+'/old-codec.js');
copyFileSync('/home/neftaly/dev/royal/packages/renderer-webgl/dist/draco-codec.js',dir+'/new-codec.js');
const root='/home/neftaly/dev/royal/apps/examples-react/public/fixtures/khronos/';const tasks=[];
for(const name of ['Duck','SunglassesKhronos']) {
 const base=root+name+'/glTF-Draco/';const doc=JSON.parse(readFileSync(base+name+'.gltf'));const buffers=doc.buffers.map(b=>readFileSync(base+b.uri));
 for(const mesh of doc.meshes)for(const p of mesh.primitives){const ext=p.extensions?.KHR_draco_mesh_compression;if(!ext)continue;const v=doc.bufferViews[ext.bufferView];tasks.push({name,attributes:ext.attributes,bytes:[...buffers[v.buffer].subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength)]});}
}
writeFileSync(dir+'/speed-tasks.json',JSON.stringify(tasks));
const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:3319/');
 const result=await page.evaluate(async()=>{
  const versions={old:await import('/old-codec.js'),new:await import('/new-codec.js')};
  const tasks=(await(await fetch('/speed-tasks.json')).json()).map(t=>({...t,bytes:new Uint8Array(t.bytes)}));
  const run=(v,times)=>{const start=performance.now();let sum=0;for(let i=0;i<times;i++)for(const t of tasks){const m=versions[v].decodeDracoMesh(t.bytes);sum+=m.numPoints();for(const id of Object.values(t.attributes))m.getAttributeByUniqueId(id).extractTo(Float32Array,m.numPoints());for(let f=0;f<m.numFaces();f++)sum+=m.face(f)[0];}return {ms:performance.now()-start,sum};};
  for(let i=0;i<5;i++){run('old',10);run('new',10);}
  const samples=[];for(let rep=0;rep<40;rep++)for(const version of rep%2?['new','old']:['old','new'])samples.push({rep,version,...run(version,10)});
  return {samples,primitives:tasks.length,corpusIterationsPerSample:10};
 });writeFileSync('/tmp/royal-draco-speed.json',JSON.stringify({browser:browser.version(),...result},null,2));
}finally{await browser.close();}
