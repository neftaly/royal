import { build } from '/home/neftaly/dev/royal/node_modules/vite/dist/node/index.js';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
const work='/tmp/royal-cold-start',repo='/home/neftaly/dev/royal';
await build({configFile:false,logLevel:'silent',build:{outDir:work+'/generator',lib:{entry:'/home/neftaly/dev/probability/apps/play/src/creation/generate-gltf.ts',formats:['es'],fileName:()=> 'generate.mjs'}}});
const {createBoxPieceGltf}=await import(work+'/generator/generate.mjs');
const card=createBoxPieceGltf('Card',{mimeType:'image/png',uri:'card.png'},[0.63,0.003,0.88]);
card.document.buffers=[{byteLength:card.buffer.byteLength,uri:'card.bin'}];
for(const variant of (process.env.ROYAL_BUILD_VARIANTS??'baseline,candidate').split(',')) {
 const pkg=variant==='baseline'?work+'/baseline-packages':repo+'/packages';
 const dir=work+'/'+variant; mkdirSync(dir,{recursive:true});
 writeFileSync(dir+'/index.html','<canvas id="canvas" width="512" height="512"></canvas><script type="module" src="./main.js"></script>');
 writeFileSync(dir+'/main.js',`
import {createRendererRoot} from '${pkg}/renderer-webgl/dist/index.js';
import {gltf, scene, perspectiveCamera, directionalLight, studioEnvironment} from '${pkg}/renderer-core/dist/index.js';
const longTasks=[];try{new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});}catch{}
const rootStarted=performance.now();
const scenario=new URL(location.href).searchParams.get('scenario');
const names={card:'card.gltf',dracoMain:'duck.glb',dracoWorker:'duck.gltf'};
const node=gltf(new URL('./models/'+names[scenario],location.href).href);
const canvas=document.querySelector('canvas');
const root=createRendererRoot(canvas,{alpha:true,antialias:true});
root.setSize({cssWidth:512,cssHeight:512,pixelRatio:1});
root.setScene(scene({camera:perspectiveCamera({position:[0,2,4],rotation:[-0.463647609,0,0]}),nodes:[node,directionalLight({direction:[0,-1,-1],illuminanceLux:3})],environment:studioEnvironment({radianceScaleNits:0.8})}));
let readyAt;const poll=()=>{
 const asset=root.getGltfAssetSnapshot(node.asset);
 if(asset.status==='error'||asset.status==='degraded'){window.result={error:JSON.stringify(asset)};return;}
 if(asset.status==='ready'){
  readyAt=performance.now();root.flushInvalidated();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
   const settledAt=performance.now();
   window.result={rootStarted,readyAt,settledAt,assetTimings:asset.timings,longTasks,frame:root.getSnapshot().frame,resources:performance.getEntriesByType('resource').map(e=>({name:e.name,duration:e.duration,transfer:e.transferSize,encoded:e.encodedBodySize,start:e.startTime}))};
  }));return;
 }
 requestAnimationFrame(poll);
};requestAnimationFrame(poll);
window.root=root;
`);
 await build({root:dir,base:'./',configFile:false,logLevel:'silent',resolve:{alias:[{find:'@royal/renderer-core/render-object',replacement:pkg+'/renderer-core/dist/render-object.js'},{find:'@royal/renderer-core',replacement:pkg+'/renderer-core/dist/index.js'}]},build:{outDir:'dist',target:'safari17',sourcemap:false}});
 const out=dir+'/dist/models';mkdirSync(out,{recursive:true});
 writeFileSync(out+'/card.gltf',JSON.stringify(card.document));writeFileSync(out+'/card.bin',card.buffer);
 copyFileSync(repo+'/apps/examples-react/public/fixtures/khronos/Duck/glTF-Draco/DuckCM.png',out+'/card.png');
 for(const name of ['duck.gltf','duck.glb','Duck.bin'])copyFileSync(new URL('./fixtures/'+name,import.meta.url),out+'/'+name);
 copyFileSync(repo+'/apps/examples-react/public/fixtures/khronos/Duck/glTF-Draco/DuckCM.png',out+'/DuckCM.png');
}
