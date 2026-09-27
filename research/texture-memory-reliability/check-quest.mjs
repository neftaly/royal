import { writeFile } from 'node:fs/promises';
import { connectCdpPage, evaluate } from '../../apps/examples-react/scripts/browser-harness.mjs';
const result = [], errors = [];
let session;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
 session = await connectCdpPage({debugHost:'127.0.0.1',debugPort:19386,commandTimeoutMs:30000});
 await session.call('Runtime.enable');
 session.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails));
 session.on('Runtime.consoleAPICalled', event => { const message=event.args?.[0]?.value; if(typeof message==='string' && message.startsWith('memory-context:')) console.log(message); });
 const settle = async (label, minimumFrame = 1) => {
  let snapshot;
  for (let n=0;n<1200;n++) {
   snapshot = await evaluate(session, 'window.textureWorkingSet?.snapshot()');
   if (snapshot?.renderer.presentation === 'failed') throw new Error(JSON.stringify(snapshot));
   if (snapshot?.renderer.presentation === 'ready' && snapshot.renderer.context.phase === 'active' && snapshot.renderer.frame >= minimumFrame) {
    const resources=snapshot.renderer.resources;
    if (resources.persistentGpu.retainedBytes > snapshot.budget || resources.virtualTextures.rasterCachePeakBytes > 33554432 || resources.imageTextures.residentTextures > 324) throw new Error('Working set exceeded its ceiling');
    result.push({label,snapshot});
    console.log(label,Math.round(snapshot.elapsedMs),resources.persistentGpu.retainedBytes,resources.imageTextures.residentTextures);
    return;
   }
   await sleep(100);
  }
  result.push({label,timeout:true,snapshot});
  throw new Error(`Timed out: ${label}`);
 };
 for (const [count,budget] of [[324,64],[3240,64],[3240,32]]) {
  await session.call('Page.navigate',{url:`http://127.0.0.1:5195/scripts/texture-working-set.html?count=${count}&budget=${budget}`});
  await sleep(1000);
  await settle(`cold-${count}-${budget}`);
  if (count===3240) {
   let frame = await evaluate(session,'(() => {const frame=window.textureWorkingSet.snapshot().renderer.frame;window.textureWorkingSet.show(9);return frame;})()'); await settle(`distant-${budget}`, frame + 1);
   frame = await evaluate(session,'(() => {const frame=window.textureWorkingSet.snapshot().renderer.frame;window.textureWorkingSet.show(0);return frame;})()'); await settle(`return-${budget}`, frame + 1);
   frame = await evaluate(session,'(() => {const frame=window.textureWorkingSet.snapshot().renderer.frame;for (const group of [1,2,3,9]) window.textureWorkingSet.show(group);return frame;})()'); await settle(`rapid-${budget}`, frame + 1);
   frame = await evaluate(session,'(() => {const frame=window.textureWorkingSet.snapshot().renderer.frame;window.textureWorkingSet.resize(1536);return frame;})()'); await settle(`resize-${budget}`, frame + 1);
   await evaluate(session,"(() => {window.textureWorkingSet.resetTimer();const canvas=document.querySelector('canvas');const ext=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');canvas.addEventListener('webglcontextlost',()=>console.log('memory-context:lost'));canvas.addEventListener('webglcontextrestored',()=>console.log('memory-context:restored'));setTimeout(()=>{console.log('memory-context:losing');ext.loseContext();console.log('memory-context:loss-submitted');setTimeout(()=>{console.log('memory-context:restoring');ext.restoreContext();},300)},0);return true;})()");
   await sleep(1000); await settle(`restored-${budget}`);
   if (result.at(-1).snapshot.renderer.context.generation < 2) throw new Error('Context did not restore');
  }
 }
 if (errors.length) throw new Error(JSON.stringify(errors));
} catch (error) {
 result.push({failure:String(error),stack:error.stack});
 throw error;
} finally {
 await writeFile(new URL('./quest-working-set.json',import.meta.url), JSON.stringify({result,errors},null,2)+'\n');
 session?.socket.close();
}
