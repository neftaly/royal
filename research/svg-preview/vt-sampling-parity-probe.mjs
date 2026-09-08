/** Compare VT atlas sampling to ordinary GPU texture sampling, including gutters. */
export async function runVtSamplingParityProbe() {
  const { VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS: source } = await import('../../packages/renderer-webgl/src/virtual-texture/shader-source.ts');
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 80;
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const shaders = [], programs = [], textures = [];
  const compile = (type, text) => {
    const shader = gl.createShader(type); shaders.push(shader);
    gl.shaderSource(shader, text); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const createProgram = (body) => {
    const program = gl.createProgram(); programs.push(program);
    gl.attachShader(program, compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}'));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; precision highp int;
      ${body}
      uniform sampler2D reference0; uniform sampler2D reference1; uniform sampler2D reference2;
      uniform int referenceMip; uniform bool referencePass;
      out vec4 color;
      void main() {
        vec2 uv = gl_FragCoord.xy / vec2(128.,80.) * 1.4 - .2;
        float wrappedX = royalVirtualWrap(uv.x, virtualSettings2.y);
        int mip = referenceMip < 0 ? (wrappedX < .5 ? 1 : 0) : referenceMip;
        if (referencePass) color = mip == 0 ? texture(reference0, uv) : mip == 1 ? texture(reference1, uv) : texture(reference2, uv);
        else color = sampleVirtualBaseColor(uv);
      }`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  };
  const texture = (unit, width, height, pixels, filter, wrap) => {
    const value = gl.createTexture(); textures.push(value);
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, value);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, filter);
    for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, wrap);
    return value;
  };
  const wrapIndex = (value, size, mode) => {
    if (mode === 0) return Math.max(0, Math.min(size - 1, value));
    const period = mode === 1 ? size : size * 2;
    const index = ((value % period) + period) % period;
    return index < size ? index : period - index - 1;
  };
  const images = [0, 1, 2].map(mip => {
    const width = 32 >> mip, height = 16 >> mip;
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      pixels.set([(x * 37 + y * 11) % 256, x < width / 2 ? 0 : 255, y < height / 2 ? 0 : 255, 255], (y * width + x) * 4);
    }
    return { width, height, pixels };
  });
  const results = [];
  try {
    const fixed = createProgram(source);
    const oldSource = source.replace('+ localTexel;', '+ localTexel + vec2(0.5);');
    if (oldSource === source) throw new Error('Legacy offset control was not applied');
    const legacy = createProgram(oldSource);
    for (const mode of [0, 1, 2]) for (const filter of [gl.LINEAR, gl.NEAREST]) for (const mip of [0, 1, 2, -1]) {
      const wrap = [gl.CLAMP_TO_EDGE, gl.REPEAT, gl.MIRRORED_REPEAT][mode];
      images.forEach((image, index) => texture(index + 2, image.width, image.height, image.pixels, filter, wrap));
      const atlas = new Uint8Array(84 * 24 * 4);
      // Poison unused cells: wrong slot addressing must not accidentally pass.
      for (let i = 0; i < atlas.length; i += 4) atlas.set([255, 0, 255, 255], i);
      const table = new Uint8Array(4 * 2 * 4), slots = new Map();
      for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) {
        const resident = mip < 0 ? (x < 2 ? 1 : 0) : mip;
        const px = x >> resident, py = y >> resident, key = `${resident}:${px}:${py}`;
        let slot = slots.get(key);
        if (slot === undefined) {
          slot = (slots.size * 3 + 1) % 14; slots.set(key, slot);
          const image = images[resident];
          for (let sy = 0; sy < 12; sy++) for (let sx = 0; sx < 12; sx++) {
            const ix = wrapIndex(px * 8 + sx - 2, image.width, mode);
            const iy = wrapIndex(py * 8 + sy - 2, image.height, mode);
            atlas.set(image.pixels.subarray((iy * image.width + ix) * 4, (iy * image.width + ix) * 4 + 4),
              ((Math.floor(slot / 7) * 12 + sy) * 84 + slot % 7 * 12 + sx) * 4);
          }
        }
        table.set([slot % 7, Math.floor(slot / 7), resident, 255], (y * 4 + x) * 4);
      }
      texture(0, 84, 24, atlas, filter, gl.CLAMP_TO_EDGE);
      texture(1, 4, 2, table, gl.NEAREST, gl.CLAMP_TO_EDGE);
      const draw = (program, reference) => {
        gl.useProgram(program);
        for (const [name, unit] of [['baseColorTexture', 0], ['virtualPageTable', 1], ['reference0', 2], ['reference1', 3], ['reference2', 4]]) gl.uniform1i(gl.getUniformLocation(program, name), unit);
        gl.uniform1i(gl.getUniformLocation(program, 'referenceMip'), mip);
        gl.uniform1i(gl.getUniformLocation(program, 'referencePass'), reference ? 1 : 0);
        gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings0'), 32, 16, 8, 2);
        gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings1'), 84, 24, 0, 0);
        gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings2'), 1, mode, mode, 12);
        gl.viewport(0, 0, 128, 80); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixels = new Uint8Array(128 * 80 * 4);
        gl.readPixels(0, 0, 128, 80, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const reference = draw(fixed, true), actual = draw(fixed, false), control = draw(legacy, false);
      let maxError = 0, legacyMismatches = 0;
      for (let i = 0; i < actual.length; i++) {
        maxError = Math.max(maxError, Math.abs(actual[i] - reference[i]));
        if (Math.abs(control[i] - reference[i]) > 1) legacyMismatches++;
      }
      const result = { mode, filter: filter === gl.LINEAR ? 'linear' : 'nearest', mip, maxError, legacyMismatches, glError: gl.getError() };
      results.push(result);
      if (maxError > 1 || legacyMismatches === 0 || result.glError) throw new Error(JSON.stringify(result));
      for (const value of textures.splice(0)) gl.deleteTexture(value);
    }
    return results;
  } finally {
    for (const value of textures) gl.deleteTexture(value);
    for (const value of programs) gl.deleteProgram(value);
    for (const value of shaders) gl.deleteShader(value);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
