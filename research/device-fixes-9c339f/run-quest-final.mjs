import {connectCdpPage,evaluate} from '/home/neftaly/dev/royal/apps/examples-react/scripts/browser-harness.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const s=await connectCdpPage({debugHost:'127.0.0.1',debugPort:9222,commandTimeoutMs:90000});
const out='/home/neftaly/dev/royal/research/device-fixes-9c339f/';
const wait=async()=>{for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,500));const p=await evaluate(s,'window.__royalExamplesRendererBenchmarkSnapshot?.()');const v=p?.virtualTexturing;if(p?.gltfLoadDiagnostics.assets[0]?.status==='ready'&&!v?.pendingDemandResources&&v?.pendingPages===0&&v?.unresidentPages===0&&v?.desiredPages===v?.admittedPages)return p;}throw new Error('Full demand failed to settle');};
try{
 await s.call('Page.enable');await s.call('Page.navigate',{url:'http://127.0.0.1:5193/gltf-scenes'});
 const source=await evaluate(s,'fetch("/__royal-source.json").then(r=>r.json())');
 for(let trial=1;trial<=2;trial++){
  const before=await wait();await evaluate(s,await readFile('/home/neftaly/dev/royal/research/device-validation-9c339f/camera-clock-probe.js','utf8'));
  let p;for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,500));p=await evaluate(s,'window.clockProbe');if(p&&!p.running)break;}
  const settled=await wait();await writeFile(out+`quest-final-${trial}.json`,JSON.stringify({source,before,probe:p,settled},null,2)+'\n');
  console.log(trial,JSON.stringify({p50:p.p50Ms,p95:p.p95Ms,max:p.maxMs,pass:p.pass,vt:settled.virtualTexturing}));
 }
 const png=await evaluate(s,'(window.__royalExamplesRenderNow?.(),document.querySelector("canvas").toDataURL("image/png"))');await writeFile(out+'quest-final.png',Buffer.from(png.split(',')[1],'base64'));
}finally{s.close();}
