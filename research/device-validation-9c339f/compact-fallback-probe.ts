import { TextureGpuOwner, ordinaryTextureStorageBytes } from '../../packages/renderer-webgl/src/texture/gpu-owner';
import { FrameUploadBudgetOwner } from '../../packages/renderer-webgl/src/resource/frame-upload-budget';

// Physical WebGL oracle for this commit's compact -> restore transition.
(globalThis as any).compactProbe = (async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64; document.body.append(canvas);
  const gl = canvas.getContext('webgl2')!;
  if (!gl) throw new Error('WebGL2 unavailable');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const report: any = { revision: '9c339f99bb3c117a3aa9fccfe91758fef44787ec', userAgent: navigator.userAgent,
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), cases: [] };
  (globalThis as any).compactProgress=report;
  for (const bitmap of [false, true]) for (const mipmapped of [false, true]) {
    const source = document.createElement('canvas'); source.width=2048; source.height=1024;
    const ctx = source.getContext('2d')!;
    ctx.fillStyle='#ff0000';ctx.fillRect(0,0,1024,512);
    ctx.fillStyle='#00ff00';ctx.fillRect(1024,0,1024,512);
    ctx.fillStyle='#0000ff';ctx.fillRect(0,512,1024,512);
    ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillRect(1024,512,1024,512);
    const pixels = bitmap ? await createImageBitmap(source, { premultiplyAlpha: 'none', imageOrientation: 'none', colorSpaceConversion: 'none' }) : source;
    const uploads = new FrameUploadBudgetOwner();
    const events: any[]=[];
    const owner = new TextureGpuOwner(gl,undefined,uploads,undefined,undefined,(key,compact)=>events.push({key,compact}));
    const recipe: any = {colorSpace:'linear',decoded:{width:2048,height:1024,source:pixels},storageKey:'probe',samplerKey:'probe',
      sampler:{magFilter:'nearest',minFilter:mipmapped?'nearest-mipmap-nearest':'nearest',wrapS:'clamp-to-edge',wrapT:'clamp-to-edge'}};
    const stages:any[]=[];
    const testCase={bitmap,mipmapped,stages,events,pass:true};report.cases.push(testCase);
    let prior:WebGLTexture|null=null;
    try {
      for (const [name,compact,width,height] of [['full',false,2048,1024],['compact',true,512,256],['compact-repeat',true,512,256],['restored',false,2048,1024]] as const) {
        uploads.beginFrame();owner.beginFrame();owner.setFallbackStorageKeys(compact?new Set(['probe']):new Set());
        const bound=owner.reconcileComplete([recipe])[0];
        const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,bound.texture,0);
        const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        const samples=[];
        for(const [x,y] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]) {
          const p=new Uint8Array(4);gl.readPixels(Math.floor(width*x),Math.floor(height*y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);samples.push([...p]);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(fb);
        const error=gl.getError();const bytes=owner.snapshot().residentBytes;
        const expectedBytes=ordinaryTextureStorageBytes(width,height,mipmapped);
        const stage={name,bytes,expectedBytes,samples,error,framebufferComplete:status===gl.FRAMEBUFFER_COMPLETE,reused:bound.texture===prior};
        stages.push(stage);
        if(error||status!==gl.FRAMEBUFFER_COMPLETE||bytes!==expectedBytes)throw new Error('Invalid storage/readback: '+JSON.stringify(stage));
        if(name==='compact-repeat'&&bound.texture!==prior)throw new Error('Repeated fallback reallocated');
        if(stages.length>1&&JSON.stringify(samples)!==JSON.stringify(stages[0].samples))testCase.pass=false;
        prior=bound.texture;
      }

    } finally { owner.dispose(); if(bitmap)(pixels as ImageBitmap).close(); }
  }
  report.pass=report.cases.every((c:any)=>c.pass);return report;
})().then(report=>{(globalThis as any).compactResult=report;document.body.append(JSON.stringify(report));return report;},error=>{(globalThis as any).compactResult={pass:false,error:String(error),stack:error.stack};});
