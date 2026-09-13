import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { PerformanceObserver } from 'node:perf_hooks';
const paths = { before: process.env.VT_BASELINE_FILE ?? '/tmp/royal-vt-before-usage-keys-runtime.ts', after: process.env.VT_CANDIDATE_FILE ?? '/tmp/royal-vt-usage-key-candidate-runtime.ts' };
const manifest = await readFile('packages/renderer-webgl/src/virtual-texture/manifest.ts', 'utf8');
const keys = manifest.slice(manifest.indexOf('const PACKED_MIP_STRIDE'), manifest.indexOf('export const derivedVirtualTextureMipCount')).replaceAll('export ', '');
const key = new Function(stripTypeScriptTypes(keys) + ';return virtualTexturePageKeyParts;')();
const functions = {}, sources = {}, results = [], events = [];
for (const [name,path] of Object.entries(paths)) {
 const source = await readFile(path,'utf8'), end = source.indexOf('    return gpuCreated;');
 const start = source.lastIndexOf(name === 'before' ? '    for (let index' : '    for (const key',end);
 if(start<0||end<start) throw new Error('Usage loop not found');
 sources[name] = source.slice(start,end);
 functions[name] = new Function('resource','gpu','frame',stripTypeScriptTypes(keys + sources[name].replaceAll('this.#frame','frame')));
}
const observer = new PerformanceObserver(list=>events.push(...list.getEntries())); observer.observe({entryTypes:['gc']});
let checksum=0, comparisons=0;
try {
 for(const [count,offset] of [[0,0],[1,0],[21,0],[256,0],[21,1000],[21,65536]]) {
  const workspace={count,mips:new Uint8Array(count),xs:new Uint32Array(count),ys:new Uint32Array(count),keys:new Set()};
  const slots=new Map();
  for(let i=0;i<count;i++) {workspace.mips[i]=i%4;workspace.xs[i]=i%16;workspace.ys[i]=offset+Math.floor(i/16);const k=key(workspace.mips[i],workspace.xs[i],workspace.ys[i]);workspace.keys.add(k);slots.set(k,i);}
  const resource={workspace};
  const gpus=Object.fromEntries(['before','after'].map(n=>[n,{residentSlots:slots,atlas:{lastUsedFrames:new Float64Array(count)}}]));
  for(const frame of [0,1,12345]) {
   for(const n of ['before','after']) functions[n](resource,gpus[n],frame);
   if(JSON.stringify([...gpus.before.atlas.lastUsedFrames])!==JSON.stringify([...gpus.after.atlas.lastUsedFrames])) throw new Error('Usage mismatch');
   comparisons++;
  }
  const iterations=Math.floor(500000/Math.sqrt(Math.max(1,count)));
  for(const n of ['before','after']) for(let i=0;i<20000;i++) functions[n](resource,gpus[n],i);
  for(let round=0;round<4;round++) for(const n of round%2?['after','before']:['before','after']) {
   global.gc();const start=performance.now(),cpuStart=process.cpuUsage();
   for(let i=0;i<iterations;i++) functions[n](resource,gpus[n],i);
   const end=performance.now(),cpu=process.cpuUsage(cpuStart);checksum+=gpus[n].atlas.lastUsedFrames[0]??0;
   await new Promise(resolve=>setTimeout(resolve,0));
   results.push({count,offset,round,version:n,iterations,cpuMs:(cpu.user+cpu.system)/1000,elapsedMs:end-start,gcEvents:events.filter(e=>e.startTime>=start&&e.startTime<end).length});
  }
 }
 await writeFile('research/vt-comparison/usage-keys-comparison.json',JSON.stringify({sources,comparisons,results,checksum,node:process.version,nodeOptions:process.execArgv,note:'Actual usage-marking loops and key helper, with prepared workspaces and GPU bookkeeping. Empty/coarse, ordinary packed, large packed and string keys. This excludes demand collection and all GL work.'},null,2)+'\n');
} finally {observer.disconnect();}
