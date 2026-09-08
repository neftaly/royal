/** Native WebGL regression: missing zoom-out targets retain finer resident tiles. */
export function probeResidentDetail(declarations) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
    out vec2 uv;
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`);
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; precision highp int;
    in vec2 uv; out vec4 color;
    ${declarations}
    void main() { color = sampleVirtualBaseColor(uv); }`);
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const atlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 24, 12);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const colors = [[0, 0, 255], [255, 0, 0], [0, 255, 0], [255, 0, 255], [255, 255, 0]];
  colors.forEach((color, slot) => {
    const bytes = new Uint8Array(6 * 6 * 4);
    for (let i = 0; i < bytes.length; i += 4) bytes.set([...color, 255], i);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, slot % 4 * 6, Math.floor(slot / 4) * 6, 6, 6, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  });
  const table = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, table);
  gl.texStorage2D(gl.TEXTURE_2D, 3, gl.RGBA8, 4, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.uniform1i(gl.getUniformLocation(program, 'baseColorTexture'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'virtualPageTable'), 1);
  gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings0'), 16, 16, 4, 1);
  gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings1'), 24, 12, 4, 4);
  gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings2'), 3, 0, 0, 6);
  const results = [];
  try {
    for (const targetReady of [false, true]) {
      for (let mip = 0; mip < 3; mip++) {
        const size = 4 >> mip;
        const bytes = new Uint8Array(size * size * 4);
        for (let i = 0; i < bytes.length; i += 4) bytes.set([0, 0, 2, 255], i);
        if (mip === 0) {
          bytes.set([1, 0, 0, 255], 0);
          bytes.set([2, 0, 0, 255], 4);
        }
        if (mip === 1 && targetReady) bytes.set([0, 1, 1, 255], 0);
        gl.texSubImage2D(gl.TEXTURE_2D, mip, 0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      }
      gl.viewport(0, 0, 8, 8); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixels = new Uint8Array(8 * 8 * 4);
      gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let mismatches = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const expected = targetReady && x < 4 && y < 4 ? colors[4]
          : !targetReady && y < 2 && x < 4 ? colors[x < 2 ? 1 : 2] : colors[0];
        for (let c = 0; c < 3; c++) if (Math.abs(pixels[(y * 8 + x) * 4 + c] - expected[c]) > 1) mismatches++;
      }
      results.push({ targetReady, mismatches, glError: gl.getError() });
    }
    return results;
  } finally {
    gl.deleteTexture(atlas); gl.deleteTexture(table);
    gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
