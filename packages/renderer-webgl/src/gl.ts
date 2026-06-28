export const createShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("Failed to create WebGL shader");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const message =
      gl.getShaderInfoLog(shader) ?? "unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
};

export const createProgram = (
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (program === null) throw new Error("Failed to create WebGL program");

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    const message =
      gl.getProgramInfoLog(program) ?? "unknown program link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
};

export const attributeLocation = (
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string,
): number => {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error(`Missing shader attribute: ${name}`);
  return location;
};

export const uniformLocation = (
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation => {
  const location = gl.getUniformLocation(program, name);
  if (location === null) throw new Error(`Missing shader uniform: ${name}`);
  return location;
};

export const createFloatBuffer = (
  gl: WebGLRenderingContext,
  values: Float32Array,
): WebGLBuffer => {
  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error("Failed to create WebGL buffer");

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);

  return buffer;
};

export const createIndexBuffer = (
  gl: WebGLRenderingContext,
  values: Uint16Array,
): WebGLBuffer => {
  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error("Failed to create WebGL index buffer");

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, values, gl.STATIC_DRAW);

  return buffer;
};

export const bindFloatAttribute = (
  gl: WebGLRenderingContext,
  location: number,
  buffer: WebGLBuffer,
  size: number,
): void => {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
};
