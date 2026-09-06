import { build } from '/home/neftaly/dev/royal/node_modules/vite/dist/node/index.js';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const repo='/home/neftaly/dev/royal',root='/tmp/royal-size-experiments';
const results={};
for(const variant of ['no-codecs','no-codecs-vt-volume']) {
 const plugin=()=>({name:'size-only-ablation',enforce:'pre',transform(code,id){
  if(id.endsWith('/gltf/draco.ts')) return code.replace('import { decodeDracoMesh } from "minidraco";', 'const decodeDracoMesh = () => { throw new Error("Codec omitted in size experiment"); };');
  if(id.endsWith('/gltf/meshopt.ts')) return code.replace('await import("meshoptimizer/decoder")','{ MeshoptDecoder: { ready: Promise.resolve(), supported: false } }');
  if(variant.endsWith('vt-volume') && id.endsWith('/virtual-texture/runtime.ts')) return 'export const createBrowserVirtualTextureRuntime = () => { throw new Error("VT omitted in size experiment"); };';
  if(variant.endsWith('vt-volume') && id.endsWith('/surface/bounded-volume-gpu-owner.ts')) return 'export class BoundedVolumeGpuOwner { constructor() { throw new Error("Volumes omitted in size experiment"); } }';
 }});
 process.chdir(repo+'/packages/renderer-webgl');
 const dist=root+'/'+variant+'-package';
 await build({configFile:repo+'/vite.config.ts',logLevel:'silent',plugins:[plugin()],worker:{plugins:()=>[plugin()]},build:{outDir:dist,sourcemap:false,emptyOutDir:true}});
 const out=root+'/'+variant;
 await build({root:repo+'/apps/examples-react/bundle-size/royal',configFile:false,logLevel:'silent',resolve:{alias:[{find:'@royal/renderer-core/render-object',replacement:repo+'/packages/renderer-core/dist/render-object.js'},{find:'@royal/renderer-core',replacement:repo+'/packages/renderer-core/dist/index.js'},{find:'@royal/renderer-webgl',replacement:dist+'/index.js'}]},build:{outDir:out,emptyOutDir:true,target:'safari17',manifest:true}});
 const files=readdirSync(out+'/assets').filter(x=>x.endsWith('.js')).map(name=>({name,bytes:gzipSync(readFileSync(out+'/assets/'+name),{level:9}).length}));
 results[variant]={total:files.reduce((a,b)=>a+b.bytes,0),files};
}
writeFileSync(root+'/ablation-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
