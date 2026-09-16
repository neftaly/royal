import { VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS } from '../../packages/renderer-webgl/src/virtual-texture/shader-source.ts';

// Oblique repeating stripes cross independently placed atlas pages. Isotropic
// filtering selects the grey coarse mip; anisotropy must preserve the stripes.
export const runVirtualTextureAnisotropySmoke = () => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  document.body.append(canvas);
  const gl = canvas.getContext('webgl2');
  if (gl === null) throw new Error('WebGL2 unavailable');
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es
precision highp float;
in vec2 position;
out vec2 uv;
void main() {
  gl_Position = vec4(position, 0, 1);
  uv = (position + 1.0) * 0.5 * vec2(16.0, 256.0);
}`));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
out vec4 color;
${VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS}
void main() { color = sampleVirtualBaseColor(uv); }
`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Shader link failed');
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const atlas = new Uint8Array(48 * 32 * 4);
  const tables = [];
  let slot = 0;
  for (let mip = 0; mip < 3; mip++) {
    const grid = 4 >> mip;
    const table = new Uint8Array(grid * grid * 4);
    for (let py = 0; py < grid; py++) for (let px = 0; px < grid; px++) {
      const sx = slot % 6;
      const sy = Math.floor(slot++ / 6);
      table.set([sx, sy, mip, 255], (py * grid + px) * 4);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const texel = ((px * 4 + x - 2) * (1 << mip) + 16) % 16;
        const value = mip === 2 ? 128 : (Math.floor(texel / 2) % 2) * 255;
        atlas.set([value, value, value, 255], ((sy * 8 + y) * 48 + sx * 8 + x) * 4);
      }
    }
    tables.push(table);
  }
  const texture = (unit, width, height, levels) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
    for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
      gl.texParameteri(gl.TEXTURE_2D, parameter, unit === 0 ? gl.LINEAR : gl.NEAREST);
    }
    for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
      gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
    }
  };
  texture(0, 48, 32, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 48, 32, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  texture(1, 4, 4, 3);
  tables.forEach((table, mip) => gl.texSubImage2D(gl.TEXTURE_2D, mip, 0, 0, 4 >> mip, 4 >> mip, gl.RGBA, gl.UNSIGNED_BYTE, table));
  const uniform = (name, value) => gl.uniform4fv(gl.getUniformLocation(program, name), value);
  for (const [name, unit] of [['baseColorTexture', 0], ['virtualCompressedAtlas', 0], ['virtualPageTable', 1]]) {
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  }
  uniform('virtualSettings0', [16, 16, 4, 2]);
  uniform('virtualSettings2', [3, 1, 1, 8]);
  uniform('virtualCompressedSettings', [48, 32, 0, 0]);
  const readRow = () => {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(256 * 4);
    gl.readPixels(0, 128, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`);
    return [...pixels].filter((_, index) => index % 4 === 0);
  };
  const results = [];
  for (const anisotropy of [1, 4, 16]) {
    uniform('virtualSettings1', [48, 32, 1, anisotropy]);
    const row = readRow();
    const minimum = Math.min(...row);
    const maximum = Math.max(...row);
    if (anisotropy < 16 ? maximum - minimum > 1 : maximum - minimum < 200) {
      throw new Error(`Incorrect ${anisotropy}x stripe contrast: ${minimum}–${maximum}`);
    }
    // The known two-texel stripe pattern checks every pixel, including seams.
    if (anisotropy === 16 && row.some((value, index) => Math.abs(value - Math.floor(index / 2) % 2 * 255) > 1)) {
      throw new Error('Directional taps corrupted a repeating page boundary');
    }
    results.push({ anisotropy, minimum, maximum });
  }

  // Explicit atlas LOD must select MIN when minified, even without mipmaps.
  for (let y = 24; y < 32; y++) for (let x = 16; x < 24; x++) {
    const value = (x % 2) * 255;
    atlas.set([value, value, value, 255], (y * 48 + x) * 4);
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 48, 32, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  uniform('virtualSettings1', [48, 32, 1, 1]);
  for (const nearestMin of [false, true]) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearestMin ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearestMin ? gl.LINEAR : gl.NEAREST);
    const intermediate = readRow().some(value => value > 0 && value < 255);
    if (intermediate === nearestMin) throw new Error('Mixed min/mag filtering was inverted');
    results.push({ nearestMin, intermediate });
  }
  return results;
};
