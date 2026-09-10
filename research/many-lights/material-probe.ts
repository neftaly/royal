import fragmentSource from '../../packages/renderer-webgl/src/webgl/shaders/surface.frag?raw';
import { PRESENTATION_GLSL } from '../../packages/renderer-webgl/src/webgl/shaders/presentation-functions';
import { PersistentGpuBudgetOwner } from '../../packages/renderer-webgl/src/resource/persistent-gpu-budget';
import type { CanonicalDirectionalLight, CanonicalPunctualLight } from '../../packages/renderer-webgl/src/surface/scene-lowering';
import { LargeLightRuntime, largeLightShader } from '../../packages/renderer-webgl/src/surface/large-light-runtime';

const vertex = `#version 300 es
out vec3 worldNormal;out vec3 worldPosition;out vec2 surfaceTextureCoordinate;
out vec3 worldTangent;out vec3 worldBitangent;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);worldPosition=vec3(p*2.-1.,0.);worldNormal=vec3(0.,0.,1.);surfaceTextureCoordinate=p;worldTangent=vec3(1.,0.,0.);worldBitangent=vec3(0.,1.,0.);}`;

const shaderSource = (large: boolean, macros: readonly string[]) => {
  let source = large ? largeLightShader(fragmentSource) : fragmentSource;
  source = source.replace('#version 300 es', '#version 300 es\n' + macros.map(m => `#define ${m}`).join('\n'));
  return source.replace('__MAX_DIRECTIONAL_LIGHTS__', '2').replace('__MAX_PUNCTUAL_LIGHTS__', '2')
    .replace('__PRESENTATION_FUNCTIONS__', PRESENTATION_GLSL)
    .replaceAll(/__(?:VIRTUAL_TEXTURE_DECLARATIONS|TRANSMISSION_DECLARATIONS|TRANSMISSION_BODY)__/g, '')
    .replaceAll(/surface(?:BaseColor|MetallicRoughness|Normal|Emissive|Occlusion|Specular|SpecularColor)TextureCoordinate/g, 'surfaceTextureCoordinate');
};

/** Full Royal fragment material path; repeated equal lights have an exact mathematical reference. */
export const runMaterials = async () => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96; document.body.append(canvas);
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true })!;
  if (gl === null) throw new Error('WebGL2 unavailable');
  const budget = new PersistentGpuBudgetOwner();
  const runtime = new LargeLightRuntime(gl, budget);
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile failure');
    return shader;
  };
  const directionals: CanonicalDirectionalLight[] = [
    { direction: [0, 0, -1], color: [0.4, 0.3, 0.2, 1] },
    { direction: [0.6, 0, -0.8], color: [0.2, 0.3, 0.4, 1] },
  ];
  const locals: CanonicalPunctualLight[] = [
    { kind: 'point', direction: [0, 0, -1], position: [0, 0, 2], range: 0, color: [0.2, 0.1, 0.05, 1], innerConeCosine: 1, outerConeCosine: 0 },
    { kind: 'spot', direction: [0, 0, -1], position: [1, 1, 2], range: 5, color: [0.05, 0.1, 0.2, 1], innerConeCosine: 0.9, outerConeCosine: 0.7 },
  ];
  const results = [];
  const textures: WebGLTexture[] = [];
  const programs: WebGLProgram[] = [];
  const texels = [
    [180, 130, 80, 128], [0, 180, 100, 255], [160, 110, 245, 255],
    [30, 10, 50, 255], [180, 180, 180, 255], [255, 255, 255, 180], [190, 220, 240, 255],
  ];
  try {
    for (let unit = 0; unit < texels.length; unit++) {
      gl.activeTexture(gl.TEXTURE0 + unit); const texture = gl.createTexture()!; textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
      const pixels = unit === 0 ? [255, 64, 0, 128].flatMap(alpha => [...texels[0]!.slice(0, 3), alpha]) : texels[unit]!;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, unit === 0 ? 2 : 1, unit === 0 ? 2 : 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixels));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    const cases = [
      ['opaque', []], ['blend', ['ALPHA_BLEND']], ['mask', ['ALPHA_MASK']],
      ['normal-map', ['NORMAL_TEXTURED', 'TANGENT']],
      ['metallic-roughness', ['METALLIC_ROUGHNESS_TEXTURED']],
      ['specular', ['SPECULAR_MATERIAL', 'SPECULAR_TEXTURED', 'SPECULAR_COLOR_TEXTURED']],
      ['emissive', ['EMISSIVE_TEXTURED']],
      ['combined', ['ALPHA_BLEND', 'NORMAL_TEXTURED', 'TANGENT', 'METALLIC_ROUGHNESS_TEXTURED', 'EMISSIVE_TEXTURED', 'SPECULAR_MATERIAL', 'SPECULAR_TEXTURED', 'SPECULAR_COLOR_TEXTURED']],
    ] as const;
    gl.viewport(0, 0, 96, 96); gl.disable(gl.DITHER);
    for (const [name, flags] of cases) for (const neutral of [false, true]) {
      let reference: Uint8Array | undefined;
      for (const copies of [1, 64, 128]) {
        const large = copies !== 1;
        const program = gl.createProgram()!; programs.push(program);
        const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, shaderSource(large, ['DIRECTIONAL_LIGHTS', 'PUNCTUAL_LIGHTS', 'VERTEX_NORMAL', 'TEXTURED', 'BASE_COLOR_TEXTURED', 'IDENTITY_TEXTURE_COORDINATES', ...flags]));
        gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failure');
        gl.useProgram(program);
        const u = (name: string) => gl.getUniformLocation(program, name);
        gl.uniform4f(u('baseColor'), 0.8, 0.7, 0.6, 0.8); gl.uniform4f(u('cameraWorldPosition'), 0, 0, 4, 1);
        gl.uniform4f(u('emissiveFactor'), 0.02, 0.03, 0.01, 0.04); gl.uniform4f(u('materialFactors'), 0.2, 0.7, 0.2, 1);
        gl.uniform4f(u('presentation'), 1, neutral ? 1 : 0, 0, 0); gl.uniform4f(u('specularFactors'), 0.9, 0.8, 0.7, 0.8);
        for (const [index, sampler] of ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'emissiveTexture', 'occlusionTexture', 'specularTexture', 'specularColorTexture'].entries()) gl.uniform1i(u(sampler), index);
        if (large) {
          const d = Array.from({ length: copies }, () => directionals.map(light => ({ ...light, color: light.color.map((v, c) => c === 3 ? v : v / copies) as unknown as CanonicalDirectionalLight['color'] }))).flat();
          const p = Array.from({ length: copies }, () => locals.map(light => ({ ...light, color: light.color.map((v, c) => c === 3 ? v : v / copies) as unknown as CanonicalPunctualLight['color'] }))).flat();
          gl.activeTexture(gl.TEXTURE13); runtime.set(d, p); gl.bindTexture(gl.TEXTURE_2D, runtime.texture!);
          gl.uniform1i(u('largeLightData'), 13); gl.uniform2i(u('largeLightCounts'), d.length, p.length);
        } else {
          gl.uniform4fv(u('directionalLightColors'), directionals.flatMap(x => [...x.color]));
          gl.uniform4fv(u('directionalLightDirections'), directionals.flatMap(x => [...x.direction, 0]));
          gl.uniform4fv(u('punctualLightColors'), locals.flatMap(x => [...x.color]));
          gl.uniform4fv(u('punctualLightDirections'), locals.flatMap(x => [...x.direction, x.kind === 'spot' ? 1 : 0]));
          gl.uniform4fv(u('punctualLightPositions'), locals.flatMap(x => [...x.position, x.range]));
          gl.uniform4fv(u('punctualLightSpotCones'), locals.flatMap(x => [x.innerConeCosine, x.outerConeCosine, 0, 0]));
        }
        gl.clearColor(0.1, 0.2, 0.3, 0.6); gl.clear(gl.COLOR_BUFFER_BIT);
        if (flags.some(x => x === 'ALPHA_BLEND')) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixels = new Uint8Array(96 * 96 * 4); gl.readPixels(0, 0, 96, 96, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        reference ??= pixels;
        let maxDifference = 0, changedChannels = 0;
        for (let index = 0; index < pixels.length; index++) { const delta = Math.abs(pixels[index]! - reference[index]!); maxDifference = Math.max(maxDifference, delta); if (delta) changedChannels++; }
        const error = gl.getError(); if (error || maxDifference > 2) throw new Error(JSON.stringify({ name, neutral, copies, error, maxDifference }));
        results.push({ name, neutral, lights: copies * 4, maxDifference, changedChannels });
      }
    }
    runtime.dispose(); if (budget.snapshot().retainedBytes !== 0) throw new Error('Light budget leak');
    return { results, samples: gl.getParameter(gl.SAMPLES), maxTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) };
  } finally {
    runtime.dispose(); for (const texture of textures) gl.deleteTexture(texture); for (const program of programs) gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.remove();
  }
};
