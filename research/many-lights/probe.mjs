import { buildPlaneLists, fixture } from './lists.mjs';
import { referencePixel } from './oracle.mjs';

const vertex = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const percentile = (values, fraction) => [...values].sort((a,b)=>a-b)[Math.floor((values.length - 1) * fraction)];
const stats = values => values.length ? { median: percentile(values,0.5), p95:percentile(values,0.95), samples:values } : null;

const fragment = (mode, capacity, brdf) => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
uniform int lightCount;
uniform vec2 viewport;
uniform float planeDepth;
${mode === 'ubo' ? `layout(std140) uniform Lights { vec4 records[${capacity * 4}]; };` : mode === 'uniform' ? `uniform vec4 records[${capacity * 4}];` : 'uniform sampler2D lightData;'}
${mode === 'tiled' ? 'uniform usampler2D lightList;' : ''}
vec4 record(int index, int field) {
  ${mode === 'ubo' || mode === 'uniform' ? 'return records[index*4+field];' : 'return texelFetch(lightData,ivec2(field,index),0);'}
}
${brdf}
out vec4 outputColor;
void main(){
 vec3 worldPosition=vec3((gl_FragCoord.xy/viewport)*8.-4.,planeDepth);
 vec3 normal=normalize(vec3(0.1*sin(worldPosition.x),0.1*cos(worldPosition.y),1.));
 vec3 viewDirection=normalize(vec3(0.,0.,6.)-worldPosition);
 float normalView=max(dot(normal,viewDirection),0.);
 vec3 lit=vec3(0.);
 ${mode === 'tiled' ? 'ivec2 tile=clamp(ivec2(gl_FragCoord.xy/viewport*16.),ivec2(0),ivec2(15)); int row=tile.y*16+tile.x; int count=int(texelFetch(lightList,ivec2(0,row),0).r);' : 'int count=lightCount;'}
 for(int slot=0;slot<${mode === 'uniform' ? capacity : 'count'};slot++){
  ${mode === 'uniform' ? 'if(slot>=count)break;' : ''}
  int index=${mode === 'tiled' ? 'int(texelFetch(lightList,ivec2(slot+1,row),0).r)' : 'slot'};
  vec4 color=record(index,0), direction=record(index,1), position=record(index,2), cone=record(index,3);
  vec3 lightDirection=-direction.xyz;
  float attenuation=1.;
  if(color.w>0.5){
   vec3 toLight=position.xyz-worldPosition;
   float distanceSquared=max(dot(toLight,toLight),0.000001);
   lightDirection=toLight*inversesqrt(distanceSquared);
   attenuation=1./distanceSquared;
   if(position.w>0.){float ratioSquared=distanceSquared/(position.w*position.w);float rangeAttenuation=max(1.-ratioSquared*ratioSquared,0.);attenuation*=rangeAttenuation*rangeAttenuation;}
   if(color.w>1.5)attenuation*=smoothstep(cone.y,cone.x,dot(-lightDirection,direction.xyz));
  }
  lit+=brdfContribution(normal,lightDirection,viewDirection,vec3(0.04),vec3(1.),vec3(0.6,0.4,0.2),normalView,0.0625)*color.rgb*attenuation;
 }
 // One common display conversion; all comparisons use identical material math.
 outputColor=vec4(pow(max(lit,vec3(0.)),vec3(1./2.2)),0.7);
}`;

const compare = (expected, actual) => {
  let changedPixels=0,maxChannelDifference=0,sum=0;
  for(let i=0;i<expected.length;i+=4){
    let changed=false;
    for(let c=0;c<4;c++){
      const delta=Math.abs(expected[i+c]-actual[i+c]);
      maxChannelDifference=Math.max(maxChannelDifference,delta);sum+=delta;changed ||= delta>0;
    }
    if(changed)changedPixels++;
  }
  return {changedPixels,maxChannelDifference,meanAbsoluteChannelDifference:sum/expected.length};
};

export const run = async ({size=256,samples=9,batch=1,orderSeed=0,counts=[0,1,4,8,16,64,256,512],kinds=['directional','sparse','dense','unbounded','mixed','tail']}={}) => {
  const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;document.body.append(canvas);
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:false});
  if(!gl)throw new Error('WebGL2 unavailable');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const capabilities={renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),maxUniformBlockSize:gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE),maxFragmentUniformVectors:gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),maxFragmentUniformBlocks:gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS),maxTextureUnits:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),timerQuery:!!timer};
  // Vite's raw request is a JS module. Import it to retain the actual shader text.
  const shaderModule=await import('../../packages/renderer-webgl/src/webgl/shaders/surface.frag?raw');
  const source=shaderModule.default;
  const brdf=source.slice(source.indexOf('const float PI'),source.indexOf('__PRESENTATION_FUNCTIONS__'));
  if(!brdf.includes('brdfContribution'))throw new Error('Royal BRDF extraction failed');
  const compile=(type,text)=>{const shader=gl.createShader(type);gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(error);}return shader;};
  const programs=new Map();
  const programFor=(mode,capacity)=>{
    const key=mode+':'+capacity;
    if(programs.has(key))return programs.get(key);
    const started=performance.now(),vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment(mode,capacity,brdf));
    const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const error=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw new Error(error);}
    const result={program,compileAndLinkMs:performance.now()-started};programs.set(key,result);return result;
  };
  const texture=(unit,width,height,format,type,data)=>{
    const handle=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,handle);
    gl.texImage2D(gl.TEXTURE_2D,0,format,width,height,0,format===gl.R32UI?gl.RED_INTEGER:gl.RGBA,type,data);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return handle;
  };
  const complete=async()=>{
    const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
    try{const deadline=performance.now()+30000;for(;;){const result=gl.clientWaitSync(sync,0,0);if(result===gl.ALREADY_SIGNALED||result===gl.CONDITION_SATISFIED)return;if(result===gl.WAIT_FAILED||performance.now()>deadline)throw new Error('GPU fence failed or timed out');await pause();}}
    finally{gl.deleteSync(sync);}
  };
  const results=[];
  try{
    gl.disable(gl.DITHER);gl.viewport(0,0,size,size);
    for(const count of counts)for(const kind of kinds){
      const data=fixture(kind,count),listStart=performance.now(),list=buildPlaneLists(data,count),listMs=performance.now()-listStart;
      const references=new Map();
      // Fixed alternating order avoids attributing a single ordering to a method.
      const rotated=['ubo','uniform','tiled'];
      const shift=(count+orderSeed)%3;
      const modes=['texture',...rotated.slice(shift),...rotated.slice(0,shift)];
      for(const mode of modes){
        const capacity=mode==='ubo'?Math.max(256,count):Math.max(1,count);
        if(mode==='ubo' && capacity*64>capabilities.maxUniformBlockSize){results.push({count,kind,mode,unsupported:'MAX_UNIFORM_BLOCK_SIZE'});continue;}
        if(mode==='uniform' && count>8)continue;
        const {program,compileAndLinkMs}=programFor(mode,mode==='texture'||mode==='tiled'?1:capacity);
        gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'lightCount'),count);gl.uniform2f(gl.getUniformLocation(program,'viewport'),size,size);
        let buffer=null,lightTexture=null,listTexture=null;
        const uploadStart=performance.now();
        if(mode==='ubo'){
          const storage=new Float32Array(capacity*16);storage.set(data);
          buffer=gl.createBuffer();gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferData(gl.UNIFORM_BUFFER,storage,gl.DYNAMIC_DRAW);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,buffer);gl.uniformBlockBinding(program,gl.getUniformBlockIndex(program,'Lights'),0);
        }else if(mode==='uniform')gl.uniform4fv(gl.getUniformLocation(program,'records'),data);
        else {lightTexture=texture(0,4,Math.max(1,count),gl.RGBA32F,gl.FLOAT,data);gl.uniform1i(gl.getUniformLocation(program,'lightData'),0);}
        if(mode==='tiled'){listTexture=texture(1,list.stride,256,gl.R32UI,gl.UNSIGNED_INT,list.indices);gl.uniform1i(gl.getUniformLocation(program,'lightList'),1);}
        const uploadSubmissionMs=performance.now()-uploadStart;
        try{
          const parity=[];
          for(const depth of [0,-2,0.5]){
            gl.uniform1f(gl.getUniformLocation(program,'planeDepth'),depth);gl.drawArrays(gl.TRIANGLES,0,3);
            const pixels=new Uint8Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
            if(mode==='texture'){
              references.set(depth,pixels);
              for(const [x,y] of [[0,0],[size-1,size-1],[Math.floor(size/2),Math.floor(size/2)],[Math.floor(size/3),Math.floor(size*2/3)]]){
                const expected=referencePixel(data,count,x,y,size,depth);
                for(let channel=0;channel<4;channel++)if(Math.abs(expected[channel]-pixels[(y*size+x)*4+channel])>2)throw new Error(JSON.stringify({oracle:'CPU',count,kind,depth,x,y,channel,expected:expected[channel],actual:pixels[(y*size+x)*4+channel]}));
              }
            }
            const comparison=compare(references.get(depth),pixels);parity.push({depth,...comparison});
            if(comparison.maxChannelDifference>2)throw new Error(JSON.stringify({count,kind,mode,...comparison}));
          }
          gl.uniform1f(gl.getUniformLocation(program,'planeDepth'),0);
          for(let i=0;i<3;i++){gl.drawArrays(gl.TRIANGLES,0,3);await complete();}
          const gpuMs=[],submissionMs=[],completionMs=[];
          for(let i=0;i<samples;i++){
            const query=timer?gl.createQuery():null;
            if(query)gl.beginQuery(timer.TIME_ELAPSED_EXT,query);
            const start=performance.now();for(let draw=0;draw<batch;draw++)gl.drawArrays(gl.TRIANGLES,0,3);submissionMs.push((performance.now()-start)/batch);
            if(query)gl.endQuery(timer.TIME_ELAPSED_EXT);
            await complete();completionMs.push((performance.now()-start)/batch);
            if(query){
              while(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))await pause();
              if(!gl.getParameter(timer.GPU_DISJOINT_EXT))gpuMs.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6/batch);
              gl.deleteQuery(query);
            }
          }
          const error=gl.getError();if(error)throw new Error('GL error '+error);
          const entry={count,kind,mode,capacity,compileAndLinkMs,uploadSubmissionMs,lightBytes:mode==='ubo'?capacity*64:data.byteLength,listBytes:mode==='tiled'?list.indices.byteLength:0,listMs:mode==='tiled'?listMs:0,meanListCount:mode==='tiled'?list.meanCount:count,maxListCount:mode==='tiled'?list.maxCount:count,parity,gpuMs:stats(gpuMs),submissionMs:stats(submissionMs),completionMs:stats(completionMs)};
          results.push(entry);document.querySelector('#status').textContent=`${kind} ${count} ${mode}`;
        }finally{gl.deleteBuffer(buffer);gl.deleteTexture(lightTexture);gl.deleteTexture(listTexture);}
      }
      await pause();
    }
    return {date:new Date().toISOString(),userAgent:navigator.userAgent,size,samples,batch,orderSeed,capabilities,source:'Royal 0.0.25 BRDF; research transport and orthographic fixture only',results};
  }finally{for(const {program} of programs.values())gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();}
};
