import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../probability/apps/play/package.json', import.meta.url));
const { webkit } = require('@playwright/test');
const browser=await webkit.launch();
try {
 const page=await browser.newPage();
 await page.route('**/__inspection_worker_probe',r=>r.fulfill({contentType:'text/html',body:'<title>Worker probe</title>'}));
 await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:5190'}/__inspection_worker_probe`);
 console.log(await page.evaluate(async()=>{
  const {InspectionReductionWorker}=await import('/packages/renderer-webgl/src/texture/inspection-reduction.ts');
  const {reduceInspectionRgba}=await import('/packages/renderer-webgl/src/texture/inspection-rgba.ts');
  const owner=new InspectionReductionWorker();
  try {
   for(const [inputWidth,inputHeight] of [[512,512],[513,517]]) {
    const rgba=new Uint8Array(inputWidth*inputHeight*4);for(let i=0;i<rgba.length;i++)rgba[i]=i%251;
    const input={rgba,inputWidth,inputHeight,width:256,height:256};
    const expected=reduceInspectionRgba(input);
    const actual=await owner.reduce(input);
    if(rgba.byteLength!==0)throw Error('buffer was not transferred');
    if(actual.reduced.some((x,i)=>x!==expected.reduced[i]))throw Error('worker pixels differ');
   }
   const pending=owner.reduce({rgba:new Uint8Array(1024*1024*4),inputWidth:1024,inputHeight:1024,width:256,height:256});
   const canceled=pending.then(()=>false,error=>error.name==='AbortError');
   owner.dispose();if(!await canceled)throw Error('disposal did not abort');
   const {TextureInspectionSampler}=await import('/packages/renderer-webgl/src/texture/inspection-sample.ts');
   const sampler=new TextureInspectionSampler();
   try {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
    canvas.getContext('2d').fillRect(0,0,1024,1024);
    const source={source:canvas,width:1024,height:1024};
    const sync=sampler.samples(source);
    const asyncImages=await sampler.samplesAsync(source,0,new AbortController().signal);
    if(sync.length!==1 || asyncImages.length!==1)throw Error('sampling failed');
    for(const image of [...sync,...asyncImages])image.width=image.height=1;
   }finally{sampler.dispose();}
   return 'WebKit worker transfer, integer/fractional pixel equivalence, disposal, and synchronous/worker GL sampling passed';
  } finally {owner.dispose();}
 }));
}finally{await browser.close();}
