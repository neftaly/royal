/** Native WebGL regression: mip residency must not move an authored edge.
 * Import and await runVtAlignmentProbe() from a Vite-served browser page.
 */
export async function runVtAlignmentProbe() {
 const { VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS: declarations } = await import('../../packages/renderer-webgl/src/virtual-texture/shader-source.ts');

  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=1;
  const gl=canvas.getContext('webgl2');
  function shader(type,s){const sh=gl.createShader(type);gl.shaderSource(sh,s);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;}
  function texture(unit,w,h,data,filter){gl.activeTexture(gl.TEXTURE0+unit);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,data);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;}
  const results=[];
  for(const corrected of [true,false])for(const mip of [0,1,2]){
   const body=corrected?declarations:declarations.replace('+ localTexel;', '+ localTexel + vec2(0.5);');
   const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 v=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(v*2.-1.,0.,1.);}'));
   gl.attachShader(p,shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float; precision highp int;\n'+body+'\nout vec4 color; void main(){color=sampleVirtualBaseColor(vec2(gl_FragCoord.x/64.,0.5));}'));
   gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
   const size=68, pixels=new Uint8Array(size*size*4), scale=2**mip;
   // Rasterize a vertical edge at virtual x=32, with two gutter texels.
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=(x-2+.5)*scale>=32?255:0;pixels[i+3]=255;}
   texture(0,size,size,pixels,gl.LINEAR);texture(1,1,1,new Uint8Array([0,0,mip,255]),gl.NEAREST);
   gl.uniform1i(gl.getUniformLocation(p,'baseColorTexture'),0);gl.uniform1i(gl.getUniformLocation(p,'virtualPageTable'),1);
   gl.uniform4f(gl.getUniformLocation(p,'virtualSettings0'),64,64,64,2);
   gl.uniform4f(gl.getUniformLocation(p,'virtualSettings1'),size,size,0,0);
   gl.uniform4f(gl.getUniformLocation(p,'virtualSettings2'),1,0,0,size);
   gl.viewport(0,0,64,1);gl.drawArrays(gl.TRIANGLES,0,3);const out=new Uint8Array(64*4);gl.readPixels(0,0,64,1,gl.RGBA,gl.UNSIGNED_BYTE,out);
   let whiteArea=0;for(let x=0;x<64;x++)whiteArea+=out[x*4]/255;
   results.push({corrected,mip,edgePosition:64-whiteArea,glError:gl.getError()});
  }
  for (const result of results) {
   const expected = result.corrected ? 32 : 32 - 0.5 * 2 ** result.mip;
   if (result.glError || Math.abs(result.edgePosition - expected) > 0.01) {
    throw new Error(JSON.stringify({ expected, ...result }));
   }
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return results;

}
