export interface HdrRenderTarget {
  readonly color: WebGLTexture;
  readonly depth: WebGLRenderbuffer;
  readonly framebuffer: WebGLFramebuffer;
  readonly height: number;
  readonly width: number;
}

export interface ScreenColorTextureResource {
  readonly height: number;
  readonly hdr: boolean;
  readonly originX: number;
  readonly originY: number;
  readonly texture: WebGLTexture;
  readonly uploaded: boolean;
  readonly width: number;
}

declare const authority: unique symbol;
export interface SurfaceRenderTargetArena { readonly [authority]: "SurfaceRenderTargetArena" }
type MutableHdr = { color: WebGLTexture; depth: WebGLRenderbuffer; framebuffer: WebGLFramebuffer; height: number; width: number };
type MutableScreen = { height: number; hdr: boolean; originX: number; originY: number; texture: WebGLTexture; uploaded: boolean; width: number };
type State = {
  readonly framebuffers: Set<WebGLFramebuffer>;
  hdr?: MutableHdr;
  readonly renderbuffers: Set<WebGLRenderbuffer>;
  transmission?: MutableScreen;
  readonly textures: Set<WebGLTexture>;
};

export const createSurfaceRenderTargetArena = (): SurfaceRenderTargetArena => ({
  framebuffers: new Set(), renderbuffers: new Set(), textures: new Set(),
} as unknown as SurfaceRenderTargetArena);

const dimension = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label} ${value}`);
};
const origin = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label} ${value}`);
};
const texture = (state: State, gl: WebGL2RenderingContext): WebGLTexture => {
  const value = gl.createTexture();
  if (value === null) throw new Error("WebGL texture creation failed");
  state.textures.add(value);
  return value;
};
const renderbuffer = (state: State, gl: WebGL2RenderingContext): WebGLRenderbuffer => {
  const value = gl.createRenderbuffer();
  if (value === null) throw new Error("WebGL renderbuffer creation failed");
  state.renderbuffers.add(value);
  return value;
};
const framebuffer = (state: State, gl: WebGL2RenderingContext): WebGLFramebuffer => {
  const value = gl.createFramebuffer();
  if (value === null) throw new Error("WebGL framebuffer creation failed");
  state.framebuffers.add(value);
  return value;
};

export const ensureHdrRenderTarget = (
  arena: SurfaceRenderTargetArena, gl: WebGL2RenderingContext, width: number, height: number,
): HdrRenderTarget => {
  dimension(width, "HDR target width"); dimension(height, "HDR target height");
  const state = arena as unknown as State;
  let target = state.hdr;
  if (target === undefined) {
    const color = texture(state, gl);
    const depth = renderbuffer(state, gl);
    const fb = framebuffer(state, gl);
    target = { color, depth, framebuffer: fb, height: 0, width: 0 };
    state.hdr = target;
  }
  if (target.width === width && target.height === height) return target;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, target.color);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, target.depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.color, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, target.depth);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Royal physical lighting requires a complete RGBA16F HDR framebuffer");
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  target.width = width; target.height = height;
  return target;
};

export const copyTransmissionScreenColorTexture = (
  arena: SurfaceRenderTargetArena, gl: WebGL2RenderingContext,
  width: number, height: number, sourceX: number, sourceY: number, hdr: boolean,
): ScreenColorTextureResource => {
  dimension(width, "transmission width"); dimension(height, "transmission height");
  origin(sourceX, "transmission source X"); origin(sourceY, "transmission source Y");
  const state = arena as unknown as State;
  let resource = state.transmission;
  if (resource === undefined) {
    const created = texture(state, gl);
    gl.activeTexture(gl.TEXTURE0 + 1); gl.bindTexture(gl.TEXTURE_2D, created);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    resource = { height: 0, hdr: false, originX: 0, originY: 0, texture: created, uploaded: false, width: 0 };
    state.transmission = resource;
  }
  const allocate = !resource.uploaded || resource.width !== width || resource.height !== height || resource.hdr !== hdr;
  gl.activeTexture(gl.TEXTURE0 + 1); gl.bindTexture(gl.TEXTURE_2D, resource.texture);
  if (allocate) gl.texImage2D(gl.TEXTURE_2D, 0, hdr ? gl.RGBA16F : gl.RGBA, width, height, 0, gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sourceX, sourceY, width, height);
  resource.width = width; resource.height = height; resource.hdr = hdr;
  resource.originX = sourceX; resource.originY = sourceY; resource.uploaded = true;
  return resource;
};

export const releaseSurfaceRenderTargetContextHandles = (
  arena: SurfaceRenderTargetArena, gl: WebGL2RenderingContext,
): void => {
  const state = arena as unknown as State;
  let error: unknown;
  const attempt = (action: () => void): void => { try { action(); } catch (caught) { error ??= caught; } };
  for (const value of state.framebuffers) attempt(() => gl.deleteFramebuffer(value));
  for (const value of state.renderbuffers) attempt(() => gl.deleteRenderbuffer(value));
  for (const value of state.textures) attempt(() => gl.deleteTexture(value));
  state.framebuffers.clear(); state.renderbuffers.clear(); state.textures.clear();
  delete state.hdr; delete state.transmission;
  if (error !== undefined) throw error;
};

export const dropSurfaceRenderTargetArenaContext = (arena: SurfaceRenderTargetArena): void => {
  const state = arena as unknown as State;
  state.framebuffers.clear(); state.renderbuffers.clear(); state.textures.clear();
  delete state.hdr; delete state.transmission;
};
