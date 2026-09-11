import { vertex, shaderSource } from './material-probe';

/** Isolates transport using Royal's complete opaque material shader and MSAA. */
export const runFullShaderTransport = async ({ size = 1024, counts = [16, 64, 256, 512], samples = 7, batch = 4, antialiasModes = [false, true], specialize = false } = {}) => {
  if (!counts.every(count => Number.isSafeInteger(count) && count > 0 && count <= 512)
    || !Number.isSafeInteger(samples) || samples < 1 || !Number.isSafeInteger(batch) || batch < 1
    || !Number.isSafeInteger(size) || size < 1) throw new Error('Invalid transport experiment dimensions');
  const results = [];
  for (const antialias of antialiasModes) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; document.body.append(canvas);
    const gl = canvas.getContext('webgl2', { antialias, alpha: false })!;
    if (!gl) throw new Error('WebGL2 unavailable');
    const blockRecords = Math.min(256, gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) / 64);
    const programs: WebGLProgram[] = [], buffers: WebGLBuffer[] = [];
    const texture = gl.createTexture()!;
    const compile = (type: number, text: string) => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
      return shader;
    };
    const fence = async () => {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!; gl.flush();
      const deadline = performance.now() + 60000;
      try { for (;;) {
        const status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return;
        if (status === gl.WAIT_FAILED || performance.now() > deadline) throw new Error('Fence failed or timed out');
        await new Promise(resolve => setTimeout(resolve, 0));
      }} finally { gl.deleteSync(sync); }
    };
    const stats = (values: number[]) => { const sorted = [...values].sort((a,b)=>a-b); return { median: sorted[Math.floor(sorted.length/2)], p95: sorted[Math.min(sorted.length-1, Math.floor(sorted.length*.95))], samples: values }; };
    try {
      for (const family of (specialize ? ['both', 'directional', 'point'] : ['both'])) for (const mode of ['texture', 'ubo']) {
        let source = shaderSource(true, ['DIRECTIONAL_LIGHTS', 'PUNCTUAL_LIGHTS', 'VERTEX_NORMAL']);
        if (family !== 'both') {
          const inactive = family === 'directional' ? 'PUNCTUAL' : 'DIRECTIONAL';
          const loop = new RegExp(`#ifdef ${inactive}_LIGHTS\\n  for \\(int index[\\s\\S]*?\\n#endif`);
          if (!loop.test(source)) throw new Error('Inactive loop not found');
          source = source.replace(loop, '');
        }
        if (mode === 'ubo') {
          const words = blockRecords * 4;
          source = source.replace('uniform highp sampler2D largeLightData;', `layout(std140) uniform Lights0 { vec4 records0[${words}]; };\nlayout(std140) uniform Lights1 { vec4 records1[${words}]; };\nvec4 lightWord(int index,int field){int word=index*4+field;return word<${words}?records0[word]:records1[word-${words}];}`)
            .replace('texelFetch(largeLightData, ivec2(field,index), 0)', 'lightWord(index,field)')
            .replace('texelFetch(largeLightData, ivec2(field,index+largeLightCounts.x), 0)', 'lightWord(index+largeLightCounts.x,field)');
        }
        const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, source), program = gl.createProgram()!;
        gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
        programs.push(program);
        if (mode === 'ubo') for (let index = 0; index < 2; index++) {
          const buffer = buffers[index] ?? gl.createBuffer()!;
          if (buffers[index] === undefined) { buffers.push(buffer); gl.bindBuffer(gl.UNIFORM_BUFFER, buffer); gl.bufferData(gl.UNIFORM_BUFFER, blockRecords*64, gl.DYNAMIC_DRAW); }
          gl.bindBufferBase(gl.UNIFORM_BUFFER, index, buffer);
          const block = gl.getUniformBlockIndex(program, `Lights${index}`);
          if (block === gl.INVALID_INDEX) throw new Error('Missing uniform block');
          gl.uniformBlockBinding(program, block, index);
        }
      }
      gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, 512, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.viewport(0, 0, size, size); gl.disable(gl.DITHER);
      for (const kind of ['directional', 'point']) for (const count of counts) {
        const data = new Float32Array(512*16);
        for (let index = 0; index < count; index++) {
          data.set([0.8/count, 0.6/count, 0.4/count, 1, 0, -0.6, -0.8, 0, 0, 1, 3, 0, 1, 0, 0, 0], index*16);
        }
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, 512, gl.RGBA, gl.FLOAT, data);
        for (let index = 0; index < 2; index++) {
          gl.bindBuffer(gl.UNIFORM_BUFFER, buffers[index]!);
          gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data.subarray(index*blockRecords*16, (index+1)*blockRecords*16));
        }
        let reference: Uint8Array | undefined;
        // Alternate order by count to reduce a fixed timing-order bias.
        const modes = counts.indexOf(count)%2 ? ['ubo','texture'] : ['texture','ubo'];
        if (specialize) modes.unshift('reference');
        for (const mode of modes) {
          document.querySelector('#status')?.replaceChildren(`${antialias?'MSAA':'single'} ${kind} ${count} ${mode}: starting`);
          const familyOffset = specialize && mode !== 'reference' ? (kind === 'directional' ? 2 : 4) : 0;
          const program = programs[familyOffset + (mode === 'ubo' ? 1 : 0)]!; gl.useProgram(program);
          const u = (name: string) => gl.getUniformLocation(program, name);
          gl.uniform4f(u('baseColor'), .7, .4, .2, 1); gl.uniform4f(u('cameraWorldPosition'), 0, 0, 4, 1);
          gl.uniform4f(u('emissiveFactor'), 0, 0, 0, .04); gl.uniform4f(u('materialFactors'), .1, .6, 0, 1);
          gl.uniform4f(u('presentation'), 1, 1, 0, 0);
          gl.uniform2i(u('largeLightCounts'), kind === 'directional' ? count : 0, kind === 'point' ? count : 0);
          gl.uniform1i(u('largeLightData'), 13);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const pixels = new Uint8Array(size*size*4); gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          reference ??= pixels; let maxDifference = 0;
          for (let i = 0; i < pixels.length; i++) maxDifference = Math.max(maxDifference, Math.abs(pixels[i]!-reference[i]!));
          if (maxDifference > 2) throw new Error(JSON.stringify({antialias,kind,count,mode,maxDifference}));
          if (mode === 'reference') continue;
          for (let i = 0; i < batch; i++) gl.drawArrays(gl.TRIANGLES,0,3); await fence();
          const completion = [], submission = [];
          for (let sample = 0; sample < samples; sample++) {
            const start = performance.now(); for (let i = 0; i < batch; i++) gl.drawArrays(gl.TRIANGLES,0,3);
            submission.push((performance.now()-start)/batch); await fence(); completion.push((performance.now()-start)/batch);
          }
          const error = gl.getError(); if (error) throw new Error(`GL error ${error}`);
          results.push({ antialias, actualSamples: gl.getParameter(gl.SAMPLES), kind, count, mode, maxDifference, completionMs: stats(completion), submissionMs: stats(submission) });
          document.querySelector('#status')?.replaceChildren(`${antialias?'MSAA':'single'} ${kind} ${count} ${mode}`);
        }
      }
    } finally { for (const program of programs) gl.deleteProgram(program); for (const buffer of buffers) gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.remove(); }
  }
  return { date: new Date().toISOString(), userAgent: navigator.userAgent, size, batch, samples, specialize, source: 'Full Royal opaque fragment shader; fixed two-block UBO versus production highp texture transport; no scene traversal', results };
};
Object.assign(window, { runManyLights: runFullShaderTransport });
