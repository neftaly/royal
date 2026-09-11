import { vertex, shaderSource } from './material-probe';

/** Compares equal-count transports and exact zero-contribution rejection. */
export const runLightRejection = async ({ size = 1024, counts = [4, 16, 256], samples = 7, batch = 4, antialiasModes = [false], variants = ['reference', 'reject', 'guard', 'brdf-gate'], kinds = ['dense', 'sparse', 'outside', 'spot'] } = {}) => {
  if (variants[0] !== 'reference' || new Set(variants).size !== variants.length
    || !variants.every(mode => ['reference', 'reject', 'guard', 'brdf-gate', 'masked-direction', 'weight-return', 'scalar-gate', 'light-function', 'production'].includes(mode))
    || counts.length === 0 || new Set(counts).size !== counts.length
    || !counts.every(count => Number.isSafeInteger(count) && count > 0 && count <= 512)
    || !Number.isSafeInteger(samples) || samples < 1 || !Number.isSafeInteger(batch) || batch < 1
    || kinds.length === 0 || !kinds.every(kind => ['directional', 'dense', 'dense-bounded', 'dense-spot', 'mixed', 'sparse', 'outside', 'spot'].includes(kind))
    || (kinds.includes('directional') && kinds.length !== 1)
    || !Number.isSafeInteger(size) || size < 1) throw new Error('Invalid transport experiment dimensions');
  const results = [];
  for (const antialias of antialiasModes) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; document.body.append(canvas);
    const gl = canvas.getContext('webgl2', { antialias, alpha: false })!;
    if (!gl) throw new Error('WebGL2 unavailable');
    const programs: WebGLProgram[] = [];
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
      for (const mode of [...variants, ...counts.filter(count => count <= 16).map(count => `uniform${count}`)]) {
        let source = shaderSource(true, ['DIRECTIONAL_LIGHTS', 'PUNCTUAL_LIGHTS', 'VERTEX_NORMAL']);
        // Keep the pre-optimization reference reproducible after production adopts a candidate.
        if (mode !== 'production') source = source.replace('#define LARGE_LIGHT_ZERO_REJECTION\n', '').replace(/#ifdef LARGE_LIGHT_ZERO_REJECTION\n[\s\S]*?#endif\n/g, '');
        if (mode.startsWith('uniform')) source = shaderSource(false, [kinds.length === 1 && kinds[0] === 'directional' ? 'DIRECTIONAL_LIGHTS' : 'PUNCTUAL_LIGHTS', 'VERTEX_NORMAL']).replace(/#define MAX_(DIRECTIONAL|PUNCTUAL)_LIGHTS 2/g, (_, family) => `#define MAX_${family}_LIGHTS ${mode.slice(7)}`);
        if (mode === 'reject') source = source.replace('      float rangeAttenuation =', '      if (ratioSquared >= 1.0) continue;\n      float rangeAttenuation =').replace('        angleCosine\n      );', '        angleCosine\n      );\n      if (attenuation == 0.0) continue;');
        if (mode === 'guard') source = source.replace('    }\n    lit += brdfContribution(', '    }\n    if (attenuation != 0.0) {\n    lit += brdfContribution(').replace(' * attenuation;\n  }', ' * attenuation;\n    }\n  }');
        if (mode === 'brdf-gate') source = source.replace('  float alphaSquared\n) {', '  float alphaSquared,\n  float lightWeight\n) {').replace('if (normalLight <= 0.0)', 'if (normalLight <= 0.0 || lightWeight == 0.0)').replace('      alphaSquared\n    ) * directionalRecord', '      alphaSquared, 1.0\n    ) * directionalRecord').replace('      alphaSquared\n    ) * punctualRecord', '      alphaSquared, attenuation\n    ) * punctualRecord');
        if (mode === 'masked-direction') source = source.replace('    }\n    lit += brdfContribution(\n      normal,\n      lightDirection,', '    }\n    lit += brdfContribution(\n      normal,\n      attenuation == 0.0 ? vec3(0.0) : lightDirection,');
        if (mode === 'weight-return') source = source.replace('  float alphaSquared\n) {', '  float alphaSquared,\n  float lightWeight\n) {\n  if (lightWeight == 0.0) return vec3(0.0);').replace('      alphaSquared\n    ) * directionalRecord', '      alphaSquared, 1.0\n    ) * directionalRecord').replace('      alphaSquared\n    ) * punctualRecord', '      alphaSquared, attenuation\n    ) * punctualRecord');
        if (mode === 'scalar-gate') source = source.replace('  float alphaSquared\n) {', '  float alphaSquared,\n  float lightWeight\n) {').replace('float normalLight = max(dot(normal, lightDirection), 0.0);', 'float normalLight = max(dot(normal, lightDirection), 0.0) * float(lightWeight != 0.0);').replace('      alphaSquared\n    ) * directionalRecord', '      alphaSquared, 1.0\n    ) * directionalRecord').replace('      alphaSquared\n    ) * punctualRecord', '      alphaSquared, attenuation\n    ) * punctualRecord');
        if (mode === 'light-function') {
          const start = source.indexOf('  for (int index = 0; index < largeLightCounts.y; index += 1) {');
          const end = source.indexOf('\n  }\n#endif', start);
          if (start < 0 || end < 0) throw new Error('Local loop missing');
          const bodyStart = source.indexOf('{', start) + 1;
          const body = source.slice(bodyStart, end).replace('      float rangeAttenuation =', '      if (ratioSquared >= 1.0) return vec3(0.0);\n      float rangeAttenuation =').replace('        angleCosine\n      );', '        angleCosine\n      );\n      if (attenuation == 0.0) return vec3(0.0);').replace('    lit += brdfContribution(', '    return brdfContribution(');
          source = source.slice(0, bodyStart) + '\n    lit += punctualContribution(index, normal, viewDirection, f0, f90, diffuseColor, normalView, alphaSquared);' + source.slice(end);
          source = source.replace('void main() {', `vec3 punctualContribution(int index, vec3 normal, vec3 viewDirection, vec3 f0, vec3 f90, vec3 diffuseColor, float normalView, float alphaSquared) {${body}\n}\nvoid main() {`);
        }
        const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, source), program = gl.createProgram()!;
        gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
        programs.push(program);
      }
      gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, 512, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.viewport(0, 0, size, size); gl.disable(gl.DITHER);
      for (const kind of kinds) for (const count of counts) {
        const data = new Float32Array(512*16);
        for (let index = 0; index < count; index++) {
          const dense = kind.startsWith('dense') || (kind === 'mixed' && index % 2 === 0);
          const spot = kind === 'spot' || kind === 'dense-spot';
          const x = kind === 'outside' ? 4 : dense ? 0 : (index % 16) / 7.5 - 1;
          const y = dense ? 0 : Math.floor(index / 16) / 7.5 - 1;
          data.set([0.8/count, 0.6/count, 0.4/count, 1, 0, 0, -1, spot ? 1 : 0, x, y, dense ? 3 : .15, kind === 'dense-bounded' ? 5 : dense || spot ? 0 : .3, kind === 'dense-spot' ? .1 : .98, kind === 'dense-spot' ? 0 : .9, 0, 0], index*16);
        }
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, 512, gl.RGBA, gl.FLOAT, data);

        let reference: Uint8Array | undefined;
        // The unmodified shader is always the pixel reference; timings rotate below.
        const modes = [...variants];
        if (count <= 16) modes.push(`uniform${count}`);
        const prepared = [];
        for (const mode of modes) {
          const program = programs[mode.startsWith('uniform') ? variants.length + counts.filter(value => value <= 16).indexOf(count) : variants.indexOf(mode)]!; gl.useProgram(program);
          const u = (name: string) => gl.getUniformLocation(program, name);
          gl.uniform4f(u('baseColor'), .7, .4, .2, 1); gl.uniform4f(u('cameraWorldPosition'), 0, 0, 4, 1);
          gl.uniform4f(u('emissiveFactor'), 0, 0, 0, .04); gl.uniform4f(u('materialFactors'), .1, .6, 0, 1);
          gl.uniform4f(u('presentation'), 1, 1, 0, 0);
          gl.uniform2i(u('largeLightCounts'), kind === 'directional' ? count : 0, kind === 'directional' ? 0 : count);
          gl.uniform1i(u('largeLightData'), 13);
        if (mode.startsWith('uniform')) for (const [field, name] of (kind === 'directional' ? ['directionalLightColors', 'directionalLightDirections'] : ['punctualLightColors', 'punctualLightDirections', 'punctualLightPositions', 'punctualLightSpotCones']).entries()) {
            const values = new Float32Array(count * 4);
            for (let index = 0; index < count; index++) values.set(data.subarray(index*16+field*4,index*16+field*4+4),index*4);
            gl.uniform4fv(u(name), values);
          }
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const pixels = new Uint8Array(size*size*4); gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          reference ??= pixels; let maxDifference = 0;
          for (let i = 0; i < pixels.length; i++) maxDifference = Math.max(maxDifference, Math.abs(pixels[i]!-reference[i]!));
          if (maxDifference > 2) throw new Error(JSON.stringify({antialias,kind,count,mode,maxDifference}));
          for (let i = 0; i < batch; i++) gl.drawArrays(gl.TRIANGLES,0,3); await fence();
          prepared.push({ mode, program, maxDifference, completion: [] as number[], submission: [] as number[] });
        }
        // Rotate each sample's order so clock/thermal drift does not favor one mode.
        for (let sample = 0; sample < samples; sample++) for (let offset = 0; offset < prepared.length; offset++) {
          const entry = prepared[(sample + offset) % prepared.length]!;
          gl.useProgram(entry.program);
          const start = performance.now(); for (let i = 0; i < batch; i++) gl.drawArrays(gl.TRIANGLES,0,3);
          entry.submission.push((performance.now()-start)/batch); await fence(); entry.completion.push((performance.now()-start)/batch);
        }
        const error = gl.getError(); if (error) throw new Error(`GL error ${error}`);
        for (const entry of prepared) results.push({ antialias, actualSamples: gl.getParameter(gl.SAMPLES), kind, count, mode: entry.mode, maxDifference: entry.maxDifference, completionMs: stats(entry.completion), submissionMs: stats(entry.submission) });
        document.querySelector('#status')?.replaceChildren(`${antialias?'MSAA':'single'} ${kind} ${count}: complete`);
      }
    } finally { for (const program of programs) gl.deleteProgram(program); gl.deleteTexture(texture); gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.remove(); }
  }
  return { date: new Date().toISOString(), userAgent: navigator.userAgent, size, batch, samples, kinds, variants, sampleOrder: 'rotated each sample', source: 'Full Royal opaque shader; same-count zero-attenuation rejection versus existing texture path; no scene traversal', results };
};
Object.assign(window, { runManyLights: runLightRejection });
