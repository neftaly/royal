import type { LinearRgba } from "@royal/renderer-core";
import type { Mat4 } from "../math/mat4";
import {
  fragmentShaderSource,
  surfaceShaderFeatureMask,
  vertexShaderSource,
  type ProgramKind,
  type SurfaceShaderFeatures,
} from "./shaders";

const MAX_STARTS_PER_FRAME = 1;
const MAX_LINKS_PER_FRAME = 1;
const PROGRAM_KIND_IDS: Readonly<Record<ProgramKind, number>> = {
  postprocess: 0,
  surface: 1,
  "surface-instanced-split": 2,
  unlit: 3,
  "unlit-instanced-split": 4,
  wireframe: 5,
};
const PROGRAM_KIND_SHIFT = 24;
const PROGRAM_CLUSTERED_FLAG = 1 << 27;
const PROGRAM_EXTENDED_MATERIAL_FLAG = 1 << 28;
const PROGRAM_ALPHA_MASK_FLAG = 1 << 29;

/** Pure, allocation-free identity for one linked program variant. */
export const programVariantKey = (
  kind: ProgramKind,
  features: SurfaceShaderFeatures | undefined,
  clusteredLights: boolean,
  extendedMaterial = false,
  alphaMask = false,
  knownFeatureMask?: number,
): number => (
  (PROGRAM_KIND_IDS[kind] << PROGRAM_KIND_SHIFT)
  | (clusteredLights ? PROGRAM_CLUSTERED_FLAG : 0)
  | (extendedMaterial ? PROGRAM_EXTENDED_MATERIAL_FLAG : 0)
  | (alphaMask ? PROGRAM_ALPHA_MASK_FLAG : 0)
  | (knownFeatureMask ?? (features === undefined ? 0 : surfaceShaderFeatureMask(features)))
) >>> 0;

export interface ParallelShaderCompileExtension {
  readonly COMPLETION_STATUS_KHR: number;
}

export interface ProgramArenaResource {
  readonly program: WebGLProgram;
}

export interface ProgramArenaSnapshot {
  readonly activeProgram: boolean;
  readonly linkedProgramCount: number;
  readonly ownedProgramCount: number;
  readonly ownedShaderCount: number;
  readonly pendingRequestCount: number;
  readonly requestCount: number;
  readonly uniformLocationCount: number;
  readonly uniformValueCount: number;
  readonly wakeRequested: boolean;
}

declare const authority: unique symbol;
export interface ProgramArena { readonly [authority]: "ProgramArena" }

type Resource = ProgramArenaResource & {
  completionKnown: boolean;
  completionPollFrame: number;
  readonly fragmentShader: WebGLShader;
  linked: boolean;
  readonly vertexShader: WebGLShader;
};

type Request = {
  readonly alphaMask: boolean;
  readonly clusteredLights: boolean;
  readonly extendedMaterial: boolean;
  readonly features: SurfaceShaderFeatures | undefined;
  readonly key: number;
  readonly kind: ProgramKind;
  resource?: Resource;
};

type UniformSlot = {
  readonly location: WebGLUniformLocation | null;
  readonly value: number[];
};

type UniformSlots = Record<string, UniformSlot | undefined>;

type State = {
  activeProgram?: WebGLProgram;
  readonly gl: WebGL2RenderingContext;
  linkFrame: number;
  linksThisFrame: number;
  readonly ownedPrograms: Set<WebGLProgram>;
  readonly ownedShaders: Set<WebGLShader>;
  parallel?: ParallelShaderCompileExtension;
  pendingHead: number;
  readonly pendingRequests: Request[];
  readonly requests: Map<number, Request>;
  startFrame: number;
  startsThisFrame: number;
  readonly uniforms: Map<WebGLProgram, UniformSlots>;
  wakeRequested: boolean;
};

export const createProgramArena = (gl: WebGL2RenderingContext): ProgramArena => ({
  gl,
  linkFrame: -1,
  linksThisFrame: 0,
  ownedPrograms: new Set(),
  ownedShaders: new Set(),
  pendingHead: 0,
  pendingRequests: [],
  requests: new Map(),
  startFrame: -1,
  startsThisFrame: 0,
  uniforms: new Map(),
  wakeRequested: false,
} as unknown as ProgramArena);

export const configureProgramArenaParallelCompile = (
  arena: ProgramArena,
  extension: ParallelShaderCompileExtension | undefined,
): void => {
  const state = arena as unknown as State;
  if (extension === undefined) delete state.parallel;
  else state.parallel = extension;
};

const requestWake = (state: State): void => {
  state.wakeRequested = true;
};

export const consumeProgramArenaWake = (arena: ProgramArena): boolean => {
  const state = arena as unknown as State;
  const requested = state.wakeRequested;
  state.wakeRequested = false;
  return requested;
};

const deleteShader = (state: State, shader: WebGLShader): void => {
  if (!state.ownedShaders.has(shader)) return;
  state.gl.deleteShader(shader);
  state.ownedShaders.delete(shader);
};

const deleteProgram = (state: State, program: WebGLProgram): void => {
  if (!state.ownedPrograms.has(program)) return;
  state.gl.deleteProgram(program);
  state.ownedPrograms.delete(program);
  if (state.activeProgram === program) delete state.activeProgram;
  state.uniforms.delete(program);
};

const releaseProgramShaders = (state: State, resource: Resource): void => {
  for (const shader of [resource.vertexShader, resource.fragmentShader]) {
    if (!state.ownedShaders.has(shader)) continue;
    if (state.ownedPrograms.has(resource.program)) state.gl.detachShader(resource.program, shader);
    deleteShader(state, shader);
  }
};

const deleteProgramResource = (state: State, resource: Resource): void => {
  releaseProgramShaders(state, resource);
  deleteProgram(state, resource.program);
};

const compileShader = (state: State, type: number, source: string): WebGLShader => {
  const shader = state.gl.createShader(type);
  if (shader === null) throw new Error("WebGL shader creation failed");
  state.ownedShaders.add(shader);
  try {
    state.gl.shaderSource(shader, source);
    state.gl.compileShader(shader);
    return shader;
  } catch (error) {
    deleteShader(state, shader);
    throw error;
  }
};

const compileProgram = (
  state: State,
  kind: ProgramKind,
  features: SurfaceShaderFeatures | undefined,
  clusteredLights: boolean,
  extendedMaterial: boolean,
  alphaMask: boolean,
): Resource => {
  const gl = state.gl;
  const program = gl.createProgram();
  if (program === null) throw new Error("WebGL program creation failed");
  state.ownedPrograms.add(program);
  let vertexShader: WebGLShader | undefined;
  let fragmentShader: WebGLShader | undefined;
  try {
    vertexShader = compileShader(state, gl.VERTEX_SHADER, vertexShaderSource(kind));
    fragmentShader = compileShader(
      state,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource(kind, features, clusteredLights, extendedMaterial, alphaMask),
    );
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    return {
      completionKnown: false,
      completionPollFrame: -1,
      fragmentShader,
      linked: false,
      program,
      vertexShader,
    };
  } catch (error) {
    if (vertexShader !== undefined) deleteShader(state, vertexShader);
    if (fragmentShader !== undefined) deleteShader(state, fragmentShader);
    deleteProgram(state, program);
    throw error;
  }
};

const startPendingPrograms = (state: State, frame: number): void => {
  if (state.startFrame !== frame) {
    state.startFrame = frame;
    state.startsThisFrame = 0;
  }
  while (
    state.pendingHead < state.pendingRequests.length
    && state.startsThisFrame < MAX_STARTS_PER_FRAME
  ) {
    const request = state.pendingRequests[state.pendingHead++]!;
    if (state.requests.get(request.key) !== request || request.resource !== undefined) continue;
    state.startsThisFrame += 1;
    try {
      request.resource = compileProgram(
        state,
        request.kind,
        request.features,
        request.clusteredLights,
        request.extendedMaterial,
        request.alphaMask,
      );
    } catch (error) {
      if (state.requests.get(request.key) === request) state.requests.delete(request.key);
      throw error;
    }
  }
  if (state.pendingHead < state.pendingRequests.length) requestWake(state);
  else {
    state.pendingRequests.length = 0;
    state.pendingHead = 0;
  }
};

const finishProgram = (state: State, frame: number, resource: Resource): Resource | undefined => {
  if (resource.linked) return resource;
  const parallel = state.parallel;
  if (parallel !== undefined && !resource.completionKnown) {
    if (resource.completionPollFrame === frame) {
      requestWake(state);
      return undefined;
    }
    resource.completionPollFrame = frame;
    if (!state.gl.getProgramParameter(resource.program, parallel.COMPLETION_STATUS_KHR)) {
      requestWake(state);
      return undefined;
    }
    resource.completionKnown = true;
  }
  if (parallel !== undefined) {
    if (state.linkFrame !== frame) {
      state.linkFrame = frame;
      state.linksThisFrame = 0;
    }
    if (state.linksThisFrame >= MAX_LINKS_PER_FRAME) {
      requestWake(state);
      return undefined;
    }
    state.linksThisFrame += 1;
  }
  const gl = state.gl;
  if (!gl.getProgramParameter(resource.program, gl.LINK_STATUS)) {
    const logs = [
      gl.getProgramInfoLog(resource.program),
      gl.getShaderInfoLog(resource.vertexShader),
      gl.getShaderInfoLog(resource.fragmentShader),
    ].filter((log): log is string => log !== null && log.trim() !== "");
    throw new Error(`WebGL shader compile or program link error: ${logs.join("\n") || "unknown driver error"}`);
  }
  resource.linked = true;
  releaseProgramShaders(state, resource);
  return resource;
};

export const requestProgram = (
  arena: ProgramArena,
  frame: number,
  kind: ProgramKind,
  features?: SurfaceShaderFeatures,
  clusteredLights = false,
  extendedMaterial = false,
  alphaMask = false,
  knownFeatureMask?: number,
): ProgramArenaResource | undefined => {
  const state = arena as unknown as State;
  const key = programVariantKey(
    kind,
    features,
    clusteredLights,
    extendedMaterial,
    alphaMask,
    knownFeatureMask,
  );
  let request = state.requests.get(key);
  if (request === undefined) {
    // Draw-time feature sets may come from a reusable planner workspace.
    // Retain a snapshot only for the lifetime of a newly compiled variant.
    request = {
      alphaMask,
      clusteredLights,
      extendedMaterial,
      features: features === undefined ? undefined : new Set(features),
      key,
      kind,
    };
    state.requests.set(key, request);
    state.pendingRequests.push(request);
  }
  startPendingPrograms(state, frame);
  const resource = request.resource;
  if (resource === undefined) {
    requestWake(state);
    return undefined;
  }
  try {
    return finishProgram(state, frame, resource);
  } catch (error) {
    if (state.requests.get(key) === request) state.requests.delete(key);
    deleteProgramResource(state, resource);
    throw error;
  }
};

const uniformSlot = (
  state: State,
  program: WebGLProgram,
  name: string,
): UniformSlot => {
  let uniforms = state.uniforms.get(program);
  if (uniforms === undefined) {
    uniforms = Object.create(null) as UniformSlots;
    state.uniforms.set(program, uniforms);
  }
  let slot = uniforms[name];
  if (slot !== undefined) return slot;
  slot = { location: state.gl.getUniformLocation(program, name), value: [] };
  uniforms[name] = slot;
  return slot;
};

const valueCached = (
  cached: readonly number[],
  value: ArrayLike<number>,
  length: number,
): boolean => {
  if (cached.length !== length) return false;
  for (let index = 0; index < length; index += 1) {
    if (cached[index] !== value[index]) return false;
  }
  return true;
};

const cacheValue = (
  cached: number[],
  value: ArrayLike<number>,
  length: number,
): void => {
  if (cached.length !== length) cached.length = length;
  for (let index = 0; index < length; index += 1) cached[index] = value[index] as number;
};

const cacheScalars = (
  cached: number[],
  length: 1 | 2 | 4,
  x: number,
  y = 0,
  z = 0,
  w = 0,
): void => {
  if (cached.length !== length) cached.length = length;
  cached[0] = x;
  if (length >= 2) cached[1] = y;
  if (length === 4) {
    cached[2] = z;
    cached[3] = w;
  }
};

const prepareVectorUniform = (
  state: State,
  program: WebGLProgram,
  name: string,
  value: ArrayLike<number>,
  length: number,
): UniformSlot | undefined => {
  const slot = uniformSlot(state, program, name);
  if (valueCached(slot.value, value, length)) return undefined;
  return slot.location === null ? undefined : slot;
};

export const useProgram = (arena: ProgramArena, program: WebGLProgram): void => {
  const state = arena as unknown as State;
  if (state.activeProgram === program) return;
  state.gl.useProgram(program);
  state.activeProgram = program;
};

export const uniformMatrix = (arena: ProgramArena, program: WebGLProgram, name: string, value: Mat4): void => {
  const state = arena as unknown as State;
  const slot = prepareVectorUniform(state, program, name, value, 16);
  if (slot === undefined) return;
  state.gl.uniformMatrix4fv(slot.location, false, value);
  cacheValue(slot.value, value, 16);
};

/** Uploads a proven-changing matrix and invalidates its ordinary value cache. */
export const uniformMatrixUncached = (
  arena: ProgramArena,
  program: WebGLProgram,
  name: string,
  value: Mat4,
): void => {
  const state = arena as unknown as State;
  const slot = uniformSlot(state, program, name);
  if (slot.location === null) return;
  state.gl.uniformMatrix4fv(slot.location, false, value);
  slot.value.length = 0;
};

export const uniformColor = (arena: ProgramArena, program: WebGLProgram, name: string, value: LinearRgba): void => {
  const state = arena as unknown as State;
  const slot = prepareVectorUniform(state, program, name, value, 4);
  if (slot === undefined) return;
  state.gl.uniform4fv(slot.location, value);
  cacheValue(slot.value, value, 4);
};

/** Scalar hot-path form that does not allocate an intermediate vector. */
export const uniform4f = (
  arena: ProgramArena,
  program: WebGLProgram,
  name: string,
  x: number,
  y: number,
  z: number,
  w: number,
): void => {
  const state = arena as unknown as State;
  const slot = uniformSlot(state, program, name);
  const cached = slot.value;
  if (
    cached?.length === 4
    && cached[0] === x
    && cached[1] === y
    && cached[2] === z
    && cached[3] === w
  ) return;
  const location = slot.location;
  if (location === null) return;
  // WebGL2 always supplies the scalar form. Keep the vector fallback for
  // intentionally minimal structural test contexts.
  if (typeof state.gl.uniform4f === "function") state.gl.uniform4f(location, x, y, z, w);
  else state.gl.uniform4fv(location, [x, y, z, w]);
  cacheScalars(cached, 4, x, y, z, w);
};

export const uniform1i = (arena: ProgramArena, program: WebGLProgram, name: string, value: number): void => {
  const state = arena as unknown as State;
  const slot = uniformSlot(state, program, name);
  const cached = slot.value;
  if (cached?.length === 1 && cached[0] === value) return;
  const location = slot.location;
  if (location === null) return;
  state.gl.uniform1i(location, value);
  cacheScalars(cached, 1, value);
};

export const uniform1f = (arena: ProgramArena, program: WebGLProgram, name: string, value: number): void => {
  const state = arena as unknown as State;
  const slot = uniformSlot(state, program, name);
  const cached = slot.value;
  if (cached?.length === 1 && cached[0] === value) return;
  const location = slot.location;
  if (location === null) return;
  state.gl.uniform1f(location, value);
  cacheScalars(cached, 1, value);
};

export const uniform2fv = (
  arena: ProgramArena,
  program: WebGLProgram,
  name: string,
  value: readonly [number, number],
): void => {
  const state = arena as unknown as State;
  const slot = prepareVectorUniform(state, program, name, value, 2);
  if (slot === undefined) return;
  state.gl.uniform2fv(slot.location, value);
  cacheValue(slot.value, value, 2);
};

export const uniform2f = (
  arena: ProgramArena,
  program: WebGLProgram,
  name: string,
  x: number,
  y: number,
): void => {
  const state = arena as unknown as State;
  const slot = uniformSlot(state, program, name);
  const cached = slot.value;
  if (cached?.length === 2 && cached[0] === x && cached[1] === y) return;
  const location = slot.location;
  if (location === null) return;
  state.gl.uniform2f(location, x, y);
  cacheScalars(cached, 2, x, y);
};

const clearState = (state: State): void => {
  delete state.activeProgram;
  delete state.parallel;
  state.requests.clear();
  state.pendingRequests.length = 0;
  state.pendingHead = 0;
  state.uniforms.clear();
  state.startFrame = -1;
  state.startsThisFrame = 0;
  state.linkFrame = -1;
  state.linksThisFrame = 0;
  state.wakeRequested = false;
};

export const releaseProgramArenaContextHandles = (arena: ProgramArena): void => {
  const state = arena as unknown as State;
  let error: { readonly value: unknown } | undefined;
  const attempt = (action: () => void): void => {
    try { action(); } catch (caught) { error ??= { value: caught }; }
  };
  // Successful deletes leave ownership immediately; failed driver deletes stay
  // quarantined in the owned sets so an active-context teardown can retry.
  for (const program of state.ownedPrograms) attempt(() => deleteProgram(state, program));
  for (const shader of state.ownedShaders) attempt(() => deleteShader(state, shader));
  clearState(state);
  if (error !== undefined) throw error.value;
};

export const dropProgramArenaContext = (arena: ProgramArena): void => {
  const state = arena as unknown as State;
  state.ownedPrograms.clear();
  state.ownedShaders.clear();
  clearState(state);
};

export const programArenaSnapshot = (arena: ProgramArena): ProgramArenaSnapshot => {
  const state = arena as unknown as State;
  let linkedProgramCount = 0;
  for (const request of state.requests.values()) {
    if (request.resource?.linked === true) linkedProgramCount += 1;
  }
  let uniformLocationCount = 0;
  for (const uniforms of state.uniforms.values()) uniformLocationCount += Object.keys(uniforms).length;
  let uniformValueCount = 0;
  for (const uniforms of state.uniforms.values()) {
    for (const slot of Object.values(uniforms)) {
      if (slot === undefined) continue;
      if (slot.value.length !== 0) uniformValueCount += 1;
    }
  }
  return {
    activeProgram: state.activeProgram !== undefined,
    linkedProgramCount,
    ownedProgramCount: state.ownedPrograms.size,
    ownedShaderCount: state.ownedShaders.size,
    pendingRequestCount: state.pendingRequests.length - state.pendingHead,
    requestCount: state.requests.size,
    uniformLocationCount,
    uniformValueCount,
    wakeRequested: state.wakeRequested,
  };
};
