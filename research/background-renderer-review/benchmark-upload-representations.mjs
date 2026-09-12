import {createRequire} from 'node:module';
import path from 'node:path';
const repo = path.resolve(process.env.PROBABILITY_PATH ?? '../probability');
const require=createRequire(path.join(repo, 'apps/onboarding/package.json'));
const {webkit}=require('@playwright/test');
const browser=await webkit.launch({headless:true});
try {
 const page=await browser.newPage();
 const result=await page.evaluate(async()=>{
  const width=2048,height=2048,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');const rgba=ctx.createImageData(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;rgba.data[i]=(x*13+y*7)%256;rgba.data[i+1]=(y*5)%256;rgba.data[i+2]=x%256;rgba.data[i+3]=(x+y)%256;}
  ctx.putImageData(rgba,0,0);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
  const options={premultiplyAlpha:'none',colorSpaceConversion:'none',imageOrientation:'none'};
  const bitmap=await createImageBitmap(blob,options);
  const gl=document.createElement('canvas').getContext('webgl2');
  const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
  const runs=[];let reference;
  for(const mode of ['whole','skip-rows','cropped','canvas-bitmap','image-data']){
   const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,width,height);gl.finish();
   let prepare=0,upload=0,maxUpload=0,maxPrepare=0;
   const start=performance.now();
   if(mode==='whole') {const t=performance.now();gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);upload=performance.now()-t;maxUpload=upload;}
   if(mode==='skip-rows')for(let y=0;y<height;y+=128){gl.pixelStorei(gl.UNPACK_SKIP_ROWS,y);const t=performance.now();gl.texSubImage2D(gl.TEXTURE_2D,0,0,y,width,128,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);const dt=performance.now()-t;upload+=dt;maxUpload=Math.max(maxUpload,dt);}
   gl.pixelStorei(gl.UNPACK_SKIP_ROWS,0);
   if(mode==='cropped')for(let y=0;y<height;y+=128){const t=performance.now();const strip=await createImageBitmap(bitmap,0,y,width,128,options);const prep=performance.now()-t;prepare+=prep;maxPrepare=Math.max(maxPrepare,prep);const at=performance.now();gl.texSubImage2D(gl.TEXTURE_2D,0,0,y,gl.RGBA,gl.UNSIGNED_BYTE,strip);const dt=performance.now()-at;upload+=dt;maxUpload=Math.max(maxUpload,dt);strip.close();}
   if(mode==='canvas-bitmap') {
    const t=performance.now();const off=new OffscreenCanvas(width,height);off.getContext('2d').drawImage(bitmap,0,0);
    const materialized=await createImageBitmap(off,options);prepare=performance.now()-t;
    const at=performance.now();gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,materialized);upload=performance.now()-at;maxUpload=upload;materialized.close();off.width=1;
   }
   if(mode==='image-data'){const t=performance.now();ctx.clearRect(0,0,width,height);ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,width,height);prepare=performance.now()-t;const at=performance.now();gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels.data);upload=performance.now()-at;maxUpload=upload;}
   gl.finish();const total=performance.now()-start;
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   const pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   let mismatches=0,maxError=0;if(reference)for(let i=0;i<pixels.length;i++){if(reference[i]!==pixels[i])mismatches++;maxError=Math.max(maxError,Math.abs(reference[i]-pixels[i]));}else reference=pixels;
   runs.push({mode,prepare,upload,maxUpload,maxPrepare,total,mismatches,maxError,error:gl.getError()});gl.deleteTexture(texture);
  }
  bitmap.close();gl.deleteFramebuffer(framebuffer);return runs;
 });
 console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
