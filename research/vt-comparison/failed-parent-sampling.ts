import { VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS } from '../../packages/renderer-webgl/src/virtual-texture/shader-source';
import { createKtx2Fixture } from '../../tests/replacement/support/ktx2-fixture';
import { parseKtx2Native } from '../../packages/renderer-webgl/src/texture/ktx2-native';
import { nativeWebGlFormat } from '../../packages/renderer-webgl/src/texture/native-storage';
export async function run() {
  const blend = new URLSearchParams(location.search).has('blend');
  const atlasHeight = blend ? 288 : 144;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const gl = canvas.getContext('webgl2', { antialias: false })!;
  if (!gl || !gl.getExtension('WEBGL_compressed_texture_astc')) throw new Error('ASTC hardware required');
  const program = gl.createProgram()!, textures: WebGLTexture[] = [];
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
    gl.attachShader(program, shader); gl.deleteShader(shader);
  };
  const texture = (unit: number) => {
    const value = gl.createTexture()!; textures.push(value); gl.activeTexture(unit); gl.bindTexture(gl.TEXTURE_2D, value);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  try {
    compile(gl.VERTEX_SHADER, `#version 300 es
      out vec2 uv; void main() { vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); uv=p; gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`);
    compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; precision highp int; in vec2 uv; out vec4 color;
      ${VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS}
      void main() { color=sampleVirtualBaseColor(uv); }`);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'baseColorTexture'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'virtualPageTable'), 1);
    gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings0'), 256, 256, 128, 8);
    gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings2'), 2, 0, 0, 144);
    texture(gl.TEXTURE1);
    gl.texStorage2D(gl.TEXTURE_2D, 2, gl.RGBA8, 2, 2);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0,0,0,255, 0,0,0,255, 0,0,0,255, 0,0,0,255]));
    gl.texSubImage2D(gl.TEXTURE_2D, 1, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(blend ? [0, 1, 1, 255] : [0, 0, 0, 0]));
    const results = [];
    for (const vk of [0, 166, 172]) {
      texture(gl.TEXTURE0);
      if (vk) {
        const parsed = parseKtx2Native(createKtx2Fixture(vk, 144, atlasHeight));
        if (blend) {
          const blocks = parsed.levels[0]!.blocks;
          const values = new DataView(blocks.buffer, blocks.byteOffset, blocks.byteLength);
          for (let offset = blocks.length / 2; offset < blocks.length; offset += 16) {
            values.setUint16(offset + 8, 0, true); values.setUint16(offset + 12, 65535, true);
          }
        }
        gl.compressedTexImage2D(gl.TEXTURE_2D, 0, nativeWebGlFormat(parsed.format, parsed.colorSpace), 144, atlasHeight, 0, parsed.levels[0]!.blocks);
      } else {
        const bytes = new Uint8Array(144 * atlasHeight * 4);
        for (let index = 0; index < bytes.length; index += 4) { bytes[index + (blend && index >= bytes.length / 2 ? 2 : 0)] = 255; bytes[index + 3] = 255; }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 144, atlasHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      }
      for (const linearMip of [0, 1]) for (const width of (blend ? [512, 224, 180, 144, 128] : [512, 180, 128])) {
        gl.uniform4f(gl.getUniformLocation(program, 'virtualSettings1'), 144, atlasHeight, linearMip, 0);
        gl.viewport(0, 0, width, width); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixel = new Uint8Array(4); gl.readPixels(width >> 1, width >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const lod = Math.max(0, Math.min(1, Math.log2(256 / width)));
        const weight = blend ? (linearMip ? lod : Math.floor(lod)) : 0;
        const expected = [Math.round(255 * (1 - weight)), 0, Math.round(255 * weight), 255];
        if (pixel.some((value, index) => Math.abs(value - expected[index]!) > 1) || gl.getError() !== gl.NO_ERROR)
          throw new Error(JSON.stringify({ vk, linearMip, width, pixel: [...pixel] }));
        results.push({ vk, linearMip, width, pixel: [...pixel], expected });
      }
    }
    return { results, blend, note: 'Production VT shader with red fine pages and either missing coarse entries or blue coarse pages in blend mode. Isolated GPU sampling, not runtime scheduling, scene timing or GC measurement.' };
  } finally { textures.forEach(value => gl.deleteTexture(value)); gl.deleteProgram(program); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}
