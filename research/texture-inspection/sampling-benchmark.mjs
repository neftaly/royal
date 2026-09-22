import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../probability/apps/play/package.json', import.meta.url));
const browsers = require('@playwright/test');
const browser = await browsers[process.env.BROWSER ?? 'chromium'].launch({headless:true});
try {
 const page = await browser.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:5190'}/tests/browser/texture-inspection.html`);
 console.log(JSON.stringify(await page.evaluate(()=>window.textureInspectionTest)));
 const timings=await page.evaluate(async()=>{
  const { TextureInspectionSampler }=await import('/packages/renderer-webgl/src/texture/inspection-sample.ts');
  const records=[];
  for(const size of [1024,2048,4096]) {
   const sampler=new TextureInspectionSampler();
   const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
   canvas.getContext('2d').fillRect(0,0,size,size);
   let last=performance.now(), maxGap=0;
   const heartbeat=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},1);
   const start=performance.now();
   const images=await sampler.samplesAsync({source:canvas,width:size,height:size},0,new AbortController().signal);
   await new Promise(resolve=>setTimeout(resolve,0));
   clearInterval(heartbeat);
   records.push({size,ms:performance.now()-start,maxGap});
   for(const image of images)image.width=image.height=1;
   sampler.dispose();
  }
  return records;
 });
 console.log(JSON.stringify({timings,errors}));
 if(errors.length)process.exitCode=1;
} finally {await browser.close();}
