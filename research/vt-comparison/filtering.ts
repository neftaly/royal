import { VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS as current } from '../../packages/renderer-webgl/src/virtual-texture/shader-source.ts';

// Exercise the production sampler body. Scaling authored UV derivatives makes
// the requested LOD controllable while keeping the real wrapping/fallback path.
export async function runFilteringBenchmark() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const gl = canvas.getContext('webgl2', { antialias: false })!;
  if (!gl) throw new Error('WebGL2 unavailable');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const shader = (type: number, source: string) => {
    const result = gl.createShader(type)!;
    gl.shaderSource(result, source); gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result)!);
    return result;
  };
  const vs = shader(gl.VERTEX_SHADER, `#version 300 es
  void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0, 1); }`);
  const programs = ['nearestMip', 'trilinear'].map(mode => {
    const fs = shader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; precision highp int;
    ${current}
    uniform float lod; out vec4 color;
    void main() { vec2 uv = gl_FragCoord.xy / vec2(256.0); color = sampleVirtualBaseColor(uv * exp2(lod)); }`);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'baseColorTexture'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'virtualPageTable'), 1);
    gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings0'), 256, 256, 128, 2);
    gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings1'), 264, 132, mode === 'trilinear' ? 1 : 0, 0);
    gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings2'), 2, 0, 0, 132);
    return { mode, program, lod: gl.getUniformLocation(program, 'lod') };
  });
  gl.deleteShader(vs);
  const atlas = gl.createTexture()!; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 264, 132);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const pixels = new Uint8Array(264 * 132 * 4);
  for (let y = 0; y < 132; y++) for (let x = 0; x < 264; x++) {
    const offset = (y * 264 + x) * 4; pixels[offset + (x < 132 ? 0 : 2)] = 255; pixels[offset + 3] = 255;
  }
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 264, 132, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const table = gl.createTexture()!; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, table);
  gl.texStorage2D(gl.TEXTURE_2D, 2, gl.RGBA8, 2, 2);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const level0 = new Uint8Array([0,0,0,255, 0,0,0,255, 0,0,0,255, 0,0,0,255]);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, level0);
  gl.texSubImage2D(gl.TEXTURE_2D, 1, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([1,0,1,255]));
  const pixel = new Uint8Array(4);
  const draw = (program: typeof programs[number], lod: number) => {
    gl.useProgram(program.program); gl.uniform1f(program.lod, lod); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(128, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  };
  const results = programs.map(program => {
    const transitions = [0, .25, .5, .75, 1].map(lod => { draw(program, lod); return { lod, rgba: [...pixel] }; });
    const samples = new Float64Array(60);
    for (let i = -15; i < samples.length; i++) {
      const start = performance.now(); draw(program, .5);
      if (i >= 0) samples[i] = performance.now() - start;
    }
    samples.sort();
    return { mode: program.mode, transitions, medianDrawReadbackMs: samples[30], p95DrawReadbackMs: samples[57] };
  });
  // Missing finer mip must remain on the available ancestor, not fade to gray.
  for (let i = 0; i < 4; i++) level0.set([1,0,1,255], i * 4);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, level0);
  draw(programs[1]!, .5);
  const fallback = [...pixel];
  const error = gl.getError();
  // Timer queries isolate GPU execution from synchronous readback/driver cost.
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const gpu = [];
  if (timer) for (const program of programs) {
    const times = [];
    // Restore distinct, resident mips for the throughput comparison.
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0,0,0,255, 0,0,0,255, 0,0,0,255, 0,0,0,255]));
    gl.useProgram(program.program); gl.uniform1f(program.lod, .5);
    for (let sample = -2; sample < 8; sample++) {
      const query = gl.createQuery()!;
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      for (let draw = 0; draw < 32; draw++) gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.endQuery(timer.TIME_ELAPSED_EXT); gl.flush();
      const deadline = performance.now() + 5000;
      while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        if (performance.now() > deadline) throw new Error('GPU query timeout');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT); gl.deleteQuery(query);
      if (disjoint) throw new Error('Disjoint GPU query; rerun benchmark');
      if (sample >= 0) times.push(ns / 1e6 / 32);
    }
    times.sort((a, b) => a - b);
    gpu.push({ mode: program.mode, medianMsPerDraw: times[4], maxMsPerDraw: times[7], samples: times.length, drawsPerQuery: 32 });
  }
  programs.forEach(p => gl.deleteProgram(p.program)); gl.deleteTexture(atlas); gl.deleteTexture(table);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (error !== gl.NO_ERROR || fallback.join() !== '0,0,255,255') throw new Error(`Fallback/GL failure ${fallback} ${error}`);
  const midpoint = results[1]!.transitions[2]!.rgba;
  if (Math.abs(midpoint[0]! - 128) > 1 || Math.abs(midpoint[2]! - 128) > 1) throw new Error('Trilinear midpoint failed');
  return { renderer, userAgent: navigator.userAgent, results, fallback, gpu,
    note: 'Draw/readback is synchronous wall time. GPU timings, when available, use non-disjoint timer queries at 256x256.' };
}
