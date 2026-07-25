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

/** Starts linking caller-owned shaders without synchronizing on completion. */
export const beginWebGlProgramLink = (
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragment: WebGLShader,
  label: string,
): WebGLProgram => {
  const program = gl.createProgram();
  if (program === null) throw new Error(`Royal could not allocate a ${label} program`);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return program;
};

/** Links caller-owned shaders and reports every available compiler diagnostic. */
export const linkWebGlProgram = (
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragment: WebGLShader,
  label: string,
): WebGLProgram => {
  const program = beginWebGlProgramLink(gl, vertex, fragment, label);
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
