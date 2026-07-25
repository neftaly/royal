/** Allocates and compiles one shader; link validation owns diagnostic reporting. */
export const compileWebGlShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error(`Royal could not allocate a ${label} shader`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
};

/**
 * Links caller-owned shaders. Deferred validation lets extension-gated callers
 * start parallel work; they assume responsibility for the later status query.
 */
export const linkWebGlProgram = (
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragment: WebGLShader,
  label: string,
  deferValidation = false,
): WebGLProgram => {
  const program = gl.createProgram();
  if (program === null) throw new Error(`Royal could not allocate a ${label} program`);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (deferValidation) return program;
  if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) return program;
  let detail = gl.getProgramInfoLog(program) || "unknown linker failure";
  const vertexDetail = gl.getShaderInfoLog(vertex);
  const fragmentDetail = gl.getShaderInfoLog(fragment);
  if (vertexDetail) detail += `; vertex: ${vertexDetail}`;
  if (fragmentDetail) detail += `; fragment: ${fragmentDetail}`;
  gl.deleteProgram(program);
  throw new Error(`Royal ${label} program link failed: ${detail}`);
};

/** Resolves one required program uniform with a stable subsystem diagnostic. */
export const requiredWebGlUniform = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  label: string,
): WebGLUniformLocation => {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) return location;
  gl.deleteProgram(program);
  throw new Error(`Royal ${label} program is missing ${name}`);
};
