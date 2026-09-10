import fragmentSource from '../../packages/renderer-webgl/src/webgl/shaders/surface.frag?raw';
import { PRESENTATION_GLSL } from '../../packages/renderer-webgl/src/webgl/shaders/presentation-functions';
import { PersistentGpuBudgetOwner } from '../../packages/renderer-webgl/src/resource/persistent-gpu-budget';
import type { CanonicalPunctualLight } from '../../packages/renderer-webgl/src/surface/scene-lowering';
import { LargeLightRuntime, largeLightShader } from '../../packages/renderer-webgl/src/surface/large-light-runtime';
import { buildViewLists } from './view-lists.mjs';

const vertex = `#version 300 es
uniform vec4 plane;
out vec3 worldPosition;out vec3 worldNormal;
void main(){vec2 ndc=vec2((gl_VertexID<<1)&2,gl_VertexID&2)*2.-1.;
worldPosition=vec3((ndc.x+plane.w)*plane.y,ndc.y*plane.z,plane.x);worldNormal=vec3(0.,0.,1.);gl_Position=vec4(ndc,0.,1.);}`;
const declarations = `precision highp int;
uniform highp usampler2D lightList;
uniform vec2 listViewport;
uint listWord(int index){return texelFetch(lightList,ivec2(index%256,index/256),0).r;}`;
const source = (tiled: boolean) => {
  let text = largeLightShader(fragmentSource).replace('#version 300 es', '#version 300 es\n#define DIRECTIONAL_LIGHTS\n#define PUNCTUAL_LIGHTS\n#define VERTEX_NORMAL');
  text = text.replace('__PRESENTATION_FUNCTIONS__', PRESENTATION_GLSL)
    .replaceAll(/__(?:VIRTUAL_TEXTURE_DECLARATIONS|TRANSMISSION_DECLARATIONS|TRANSMISSION_BODY)__/g, '')
    .replace('__MAX_DIRECTIONAL_LIGHTS__', '0').replace('__MAX_PUNCTUAL_LIGHTS__', '0');
  if (tiled) text = text.replace('uniform highp sampler2D largeLightData;', declarations+'\nuniform highp sampler2D largeLightData;')
    .replace('for (int index = 0; index < largeLightCounts.y; index += 1) {', `ivec2 tile=clamp(ivec2(gl_FragCoord.xy/listViewport*16.),ivec2(0),ivec2(15));
    int header=(tile.y*16+tile.x)*2;int offset=int(listWord(header));int count=int(listWord(header+1));
    for(int slot=0;slot<count;slot++){int index=int(listWord(offset+slot));`);
  return text;
};

/** Full Royal BRDF/material with global and conservative perspective tile lists. */
export const runViewLists = async ({ size = 128, counts = [1, 256, 512] } = {}) => {
  const canvas=document.createElement('canvas'); canvas.width=canvas.height=size; document.body.append(canvas);
  const gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false})!;
  if (!gl) throw new Error('WebGL2 unavailable');
  const runtime=new LargeLightRuntime(gl,new PersistentGpuBudgetOwner());
  const programs: WebGLProgram[]=[]; const results=[];
  const compile=(type:number,text:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)!);return shader;};
  try {
    for(const tiled of [false,true]){
      const program=gl.createProgram()!,vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,source(tiled));
      gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)!);programs.push(program);
    }
    gl.viewport(0,0,size,size);gl.disable(gl.DITHER);
    for(const projection of ['orthographic','left','right'])for(const kind of ['sparse','dense','unbounded','tail'])for(const count of counts){
      const shift=projection==='left'?-0.12:projection==='right'?0.12:0;
      const near=0.1,far=30,sx=1.3,sy=1.7;
      const matrix=projection==='orthographic'?[0.2,0,0,0,0,0.25,0,0,0,0,-2/(far-near),0,0,0,-(far+near)/(far-near),1]
        :[sx,0,0,0,0,sy,0,0,shift,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
      const lights:CanonicalPunctualLight[]=Array.from({length:count},(_,i)=>({
        kind:i%3===0?'spot':'point',color:[kind==='tail'&&i!==count-1?0:0.04,kind==='tail'&&i!==count-1?0:0.025,kind==='tail'&&i!==count-1?0:0.015,1],
        position:[((i*37)%101)/101*8-4,((i*19)%97)/97*6-3,-1-((i*31)%89)/89*10],direction:[0,0,-1],
        range:kind==='unbounded'?0:kind==='dense'?20:1.5,innerConeCosine:0.9,outerConeCosine:0.7,
      }));
      runtime.set([],lights);
      for(const budget of [1024*1024,2048]){
        const began=performance.now(),lists=buildViewLists(lights,matrix,{byteBudget:budget}),listMs=performance.now()-began;
        let listTexture:WebGLTexture|null=null;
        if(lists.kind==='tiled'){
          const padded=new Uint32Array(Math.ceil(lists.words.length/256)*256);padded.set(lists.words);
          listTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE14);gl.bindTexture(gl.TEXTURE_2D,listTexture);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.R32UI,256,padded.length/256,0,gl.RED_INTEGER,gl.UNSIGNED_INT,padded);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        }
        try {for(const depth of [-0.2,-4,-12]){
          let reference:Uint8Array|undefined;let maxDifference=0;
          for(const useLists of [false,true]){
            const program=programs[useLists&&lists.kind==='tiled'?1:0]!;gl.useProgram(program);
            const u=(name:string)=>gl.getUniformLocation(program,name);
            gl.uniform4f(u('plane'),depth,projection==='orthographic'?5:-depth/sx,projection==='orthographic'?4:-depth/sy,shift);
            gl.uniform4f(u('baseColor'),0.7,0.4,0.2,1);gl.uniform4f(u('cameraWorldPosition'),0,0,0,1);
            gl.uniform4f(u('emissiveFactor'),0,0,0,0.04);gl.uniform4f(u('materialFactors'),0.1,0.6,0,1);gl.uniform4f(u('presentation'),1,1,0,0);
            gl.uniform2i(u('largeLightCounts'),0,count);gl.uniform1i(u('largeLightData'),13);gl.uniform1i(u('lightList'),14);gl.uniform2f(u('listViewport'),size,size);
            gl.activeTexture(gl.TEXTURE13);gl.bindTexture(gl.TEXTURE_2D,runtime.texture!);gl.drawArrays(gl.TRIANGLES,0,3);
            const pixels=new Uint8Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);reference??=pixels;
            for(let i=0;i<pixels.length;i++)maxDifference=Math.max(maxDifference,Math.abs(pixels[i]!-reference[i]!));
          }
          const error=gl.getError();if(error||maxDifference>2)throw new Error(JSON.stringify({projection,kind,count,depth,budget,error,maxDifference}));
          results.push({projection,kind,count,depth,budget,mode:lists.kind,maxDifference,listMs,meanCount:lists.kind==='tiled'?lists.meanCount:count,uploadBytes:lists.kind==='tiled'?lists.uploadBytes:0});
        }} finally {gl.deleteTexture(listTexture);}
      }
    }
    return {date:new Date().toISOString(),size,results};
  } finally {runtime.dispose();for(const program of programs)gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();}
};
