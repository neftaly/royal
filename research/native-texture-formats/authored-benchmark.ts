import { parseKtx2Native } from "../../packages/renderer-webgl/src/texture/ktx2-native";
import { nativeWebGlFormat } from "../../packages/renderer-webgl/src/texture/native-storage";
import { createKtx2Fixture } from "../../tests/replacement/support/ktx2-fixture";

/** Run encode-benchmark.py first. Measures real encoded content and full-screen sampling. */
export const runAuthoredTextureBenchmark = async () => {
  const canvas=document.createElement("canvas");canvas.width=canvas.height=1024;
  const gl=canvas.getContext("webgl2",{antialias:false})!;
  const astc=gl.getExtension("WEBGL_compressed_texture_astc");
  if (!astc?.getSupportedProfiles().includes("ldr")) return {unsupported:true};
  const debug=gl.getExtension("WEBGL_debug_renderer_info");
  const renderer=debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  const vertex=gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vertex,"#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}");gl.compileShader(vertex);
  const fragment=gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fragment,"#version 300 es\nprecision highp float;uniform sampler2D t;out vec4 c;void main(){c=texture(t,gl_FragCoord.xy/1024.);}");gl.compileShader(fragment);
  const program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
  gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,"t"),0);
  const results=[];
  const completionPixel=new Uint8Array(4);
  const scratch="/node_modules/.cache/royal-native-bench/";
  const median=(samples:number[])=>samples.sort((a,b)=>a-b)[samples.length>>1]!;
  for(const name of ["tiger","sponza"]){
    const response=await fetch(`${scratch}${name}-1024.png`);
    if(!response.ok) throw new Error("Run encode-benchmark.py first");
    const bitmap=await createImageBitmap(await response.blob(),{premultiplyAlpha:"none",colorSpaceConversion:"none"});
    let reference:Uint8Array|undefined;
    for(const format of ["rgba8","astc-6x6","astc-8x8"]){
      for(const quality of format==="rgba8"?["original"]:["fastest","medium"]){
        let blocks:Uint8Array|undefined;
        let glFormat: number=gl.SRGB8_ALPHA8;
        if(format!=="rgba8"){
          const block=format==="astc-6x6"?6:8;
          const response=await fetch(`${scratch}${name}-1024-${block}-${quality}.astc`);
          if(!response.ok)throw new Error("Missing encoded benchmark input");
          const astcBytes=new Uint8Array(await response.arrayBuffer());
          if(astcBytes[4]!==block||astcBytes[5]!==block)throw new Error("ASTC footprint mismatch");
          const container=createKtx2Fixture(block===6?166:172,1024,1024);
          const parsed=parseKtx2Native(container);blocks=parsed.levels[0]!.blocks;
          blocks.set(astcBytes.subarray(16));glFormat=nativeWebGlFormat(parsed.format,"srgb");
        }
        const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        const uploadTimes=[],drawTimes=[];
        for(let trial=0;trial<13;trial++){
          let start=performance.now();
          if(blocks)gl.compressedTexImage2D(gl.TEXTURE_2D,0,glFormat,1024,1024,0,blocks);
          else gl.texImage2D(gl.TEXTURE_2D,0,gl.SRGB8_ALPHA8,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
          gl.finish();const upload=performance.now()-start;
          start=performance.now();gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,completionPixel);const draw=performance.now()-start;
          if(gl.getError()!==gl.NO_ERROR)throw new Error(`GL error for ${format}`);
          if(trial>1){uploadTimes.push(upload);drawTimes.push(draw);}
        }
        const pixels=new Uint8Array(1024*1024*4);gl.readPixels(0,0,1024,1024,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let squaredError=0;
        if(reference)for(let i=0;i<pixels.length;i++)squaredError+=(pixels[i]!-reference[i]!)**2;
        else reference=pixels;
        results.push({source:name,format,quality,bytes:blocks?.length??1024*1024*4,
          uploadMedianMs:median(uploadTimes),drawReadbackMedianMs:median(drawTimes),
          linearRgbaPsnrDb:squaredError===0?null:10*Math.log10(255**2/(squaredError/pixels.length))});
        gl.deleteTexture(texture);
      }
    }
    bitmap.close();
  }
  gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);gl.getExtension("WEBGL_lose_context")?.loseContext();
  return {renderer,results,note:"1024x1024 real encoded images, nearest sampling, one full-screen draw, warmed upload submission with gl.finish, draw completion forced with one-pixel readPixels. PSNR compares quantized linear RGBA framebuffer pixels, not source-space encoder quality. SwiftShader is not representative of native GPU throughput."};
};
