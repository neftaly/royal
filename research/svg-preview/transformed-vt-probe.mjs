/** Native shader regression: VT artwork and independently transformed normal UVs. */
export const runTransformedVtProbe = async () => {
  const { SurfaceProgramOwner } = await import('../../packages/renderer-webgl/src/surface/surface-program-owner.ts');
  const f = await import('../../packages/renderer-webgl/src/surface/surface-program-features.ts');
  const { VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS } = await import('../../packages/renderer-webgl/src/virtual-texture/shader-source.ts');
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  const owner = new SurfaceProgramOwner(gl);
  owner.setVirtualTextureDeclarations(VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS);
  const results = [];
  try {
    for (const kind of ['standard', 'unlit']) {
      for (const identity of [false, true]) {
        const features = f.SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE
          | (kind === 'standard' ? f.SURFACE_FEATURE_NORMAL_TEXTURE | f.SURFACE_FEATURE_STUDIO_ENVIRONMENT | f.SURFACE_FEATURE_VERTEX_NORMAL : 0)
          | (identity ? f.SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES : 0);
        // This links the actual production vertex/fragment pair and resolves its uniforms.
        const surface = owner.get(kind, features, false, false, false);
        if (identity) {
          results.push({ kind, identity, linked: true });
          continue;
        }
        if (!surface.textureCoordinates || (kind === 'standard' && !surface.normalTextureCoordinates)) {
          throw new Error('Missing coordinate bindings');
        }
        // Capture production vertex outputs to verify UV-set selection and separate transforms.
        const vertex = gl.getAttachedShaders(surface.program).find(shader =>
          gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER);
        const fragment = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragment, '#version 300 es\nprecision highp float; out vec4 color; void main() { color = vec4(1.0); }');
        gl.compileShader(fragment);
        const program = gl.createProgram();
        const buffer = gl.createBuffer();
        const feedback = gl.createTransformFeedback();
        try {
          gl.attachShader(program, vertex);
          gl.attachShader(program, fragment);
          gl.transformFeedbackVaryings(program, [
            'surfaceBaseColorTextureCoordinate',
            ...(kind === 'standard' ? ['surfaceNormalTextureCoordinate'] : []),
          ], gl.INTERLEAVED_ATTRIBS);
          gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
          gl.useProgram(program);
          gl.vertexAttrib2f(2, 0.125, 0.25);
          gl.vertexAttrib2f(11, 0.625, 0.75);
          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
          gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buffer);
          gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, 16, gl.STREAM_READ);
          gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffer);
          gl.enable(gl.RASTERIZER_DISCARD);
          for (const baseSet of [0, 1]) {
            gl.uniform4f(gl.getUniformLocation(program, 'baseColorTextureCoordinates0'), 2, 0, 0.125, baseSet);
            gl.uniform4f(gl.getUniformLocation(program, 'baseColorTextureCoordinates1'), 0, 3, 0.25, 0);
            gl.uniform4f(gl.getUniformLocation(program, 'normalTextureCoordinates0'), 1500, 0, 0, 1 - baseSet);
            gl.uniform4f(gl.getUniformLocation(program, 'normalTextureCoordinates1'), 0, 750, 0, 0);
            gl.beginTransformFeedback(gl.POINTS);
            gl.drawArrays(gl.POINTS, 0, 1);
            gl.endTransformFeedback();
            const actual = new Float32Array(kind === 'standard' ? 4 : 2);
            gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, actual);
            const baseUv = baseSet ? [0.625, 0.75] : [0.125, 0.25];
            const normalUv = baseSet ? [0.125, 0.25] : [0.625, 0.75];
            const expected = [baseUv[0] * 2 + 0.125, baseUv[1] * 3 + 0.25,
              ...(kind === 'standard' ? [normalUv[0] * 1500, normalUv[1] * 750] : [])];
            const error = gl.getError();
            if (error || expected.some((value, i) => value !== actual[i])) {
              throw new Error(JSON.stringify({ kind, baseSet, expected, actual: [...actual], error }));
            }
            results.push({ kind, identity, baseSet, linked: true, coordinates: [...actual] });
          }
        } finally {
          gl.disable(gl.RASTERIZER_DISCARD);
          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
          gl.deleteTransformFeedback(feedback);
          gl.deleteBuffer(buffer);
          gl.deleteProgram(program);
          gl.deleteShader(fragment);
        }
      }
    }
    return results;
  } finally {
    owner.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
};
