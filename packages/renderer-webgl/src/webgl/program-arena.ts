import type { Rgba } from "@royal/renderer-core";
import type { Mat4 } from "../math/mat4";
import {
  fragmentShaderSource,
  surfaceShaderFeatureKey,
  vertexShaderSource,
  type ProgramKind,
  type SurfaceShaderFeatures,
} from "./shaders";

const MAX_STARTS_PER_FRAME = 1;
const MAX_LINKS_PER_FRAME = 1;

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
  readonly fragmentShader: WebGLShader;
  linked: boolean;
  readonly vertexShader: WebGLShader;
};

type Request = {
  readonly clusteredLights: boolean;
  readonly features: SurfaceShaderFeatures | undefined;
  readonly key: string;
  readonly kind: ProgramKind;
  resource?: Resource;
};

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
  readonly requests: Map<string, Request>;
  startFrame: number;
  startsThisFrame: number;
  readonly uniformLocations: Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>;
  readonly uniformValues: Map<WebGLProgram, Map<string, readonly number[]>>;
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
  uniformLocations: new Map(),
  uniformValues: new Map(),
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
  state.uniformLocations.delete(program);
  state.uniformValues.delete(program);
};

const releaseProgramShaders = (state: State, resource: Resource): void => {
  for (const shader of [resource.vertexShader, resource.fragmentShader]) {
    if (!state.ownedShaders.has(shader)) continue;
    if (state.ownedPrograms.has(resource.program)) state.gl.detachShader?.(resource.program, shader);
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
): Resource => {
  const gl = state.gl;
  const program = gl.createProgram();
  if (program === null) throw new Error("WebGL program creation failed");
  state.ownedPrograms.add(program);
  let vertexShader: WebGLShader | undefined;
  let fragmentShader: WebGLShader | undefined;
  try {
    vertexShader = compileShader(state, gl.VERTEX_SHADER, vertexShaderSource(kind));
    fragmentShader = compileShader(state, gl.FRAGMENT_SHADER, fragmentShaderSource(kind, features, clusteredLights));
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    return { fragmentShader, linked: false, program, vertexShader };
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
      request.resource = compileProgram(state, request.kind, request.features, request.clusteredLights);
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
  if (
    parallel !== undefined
    && !state.gl.getProgramParameter(resource.program, parallel.COMPLETION_STATUS_KHR)
  ) {
    requestWake(state);
    return undefined;
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
): ProgramArenaResource | undefined => {
  const state = arena as unknown as State;
  const key = features === undefined
    ? kind
    : `${kind}:${surfaceShaderFeatureKey(features)}:${clusteredLights ? "clustered" : "global"}`;
  let request = state.requests.get(key);
  if (request === undefined) {
    request = { clusteredLights, features, key, kind };
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

const uniformLocation = (
  state: State,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation | null => {
  let locations = state.uniformLocations.get(program);
  if (locations === undefined) {
    locations = new Map();
    state.uniformLocations.set(program, locations);
  }
  if (locations.has(name)) return locations.get(name) ?? null;
  const location = state.gl.getUniformLocation(program, name);
  locations.set(name, location);
  return location;
};

const valueCached = (
  state: State,
  program: WebGLProgram,
  name: string,
  value: ArrayLike<number>,
  length: number,
): boolean => {
  const cached = state.uniformValues.get(program)?.get(name);
  if (cached === undefined || cached.length !== length) return false;
  for (let index = 0; index < length; index += 1) {
    if (!Object.is(cached[index], value[index])) return false;
  }
  return true;
};

const cacheValue = (
  state: State,
  program: WebGLProgram,
  name: string,
  value: ArrayLike<number>,
  length: number,
): void => {
  let values = state.uniformValues.get(program);
  if (values === undefined) {
    values = new Map();
    state.uniformValues.set(program, values);
  }
  const copy = Array.from<number>({ length });
  for (let index = 0; index < length; index += 1) copy[index] = value[index] as number;
  values.set(name, copy);
};

const prepareVectorUniform = (
  state: State,
  program: WebGLProgram,
  name: string,
  value: ArrayLike<number>,
  length: number,
): WebGLUniformLocation | undefined => {
  if (valueCached(state, program, name, value, length)) return undefined;
  const location = uniformLocation(state, program, name);
  return location ?? undefined;
};

export const useProgram = (arena: ProgramArena, program: WebGLProgram): void => {
  const state = arena as unknown as State;
  if (state.activeProgram === program) return;
  state.gl.useProgram(program);
  state.activeProgram = program;
};

export const uniformMatrix = (arena: ProgramArena, program: WebGLProgram, name: string, value: Mat4): void => {
  const state = arena as unknown as State;
  const location = prepareVectorUniform(state, program, name, value, 16);
  if (location === undefined) return;
  state.gl.uniformMatrix4fv(location, false, value);
  cacheValue(state, program, name, value, 16);
};

export const uniformColor = (arena: ProgramArena, program: WebGLProgram, name: string, value: Rgba): void => {
  const state = arena as unknown as State;
  const location = prepareVectorUniform(state, program, name, value, 4);
  if (location === undefined) return;
  state.gl.uniform4fv(location, value);
  cacheValue(state, program, name, value, 4);
};

export const uniform1i = (arena: ProgramArena, program: WebGLProgram, name: string, value: number): void => {
  const state = arena as unknown as State;
  const cached = state.uniformValues.get(program)?.get(name);
  if (cached?.length === 1 && Object.is(cached[0], value)) return;
  const location = uniformLocation(state, program, name);
  if (location === null) return;
  state.gl.uniform1i(location, value);
  cacheValue(state, program, name, { 0: value, length: 1 }, 1);
};

export const uniform1f = (arena: ProgramArena, program: WebGLProgram, name: string, value: number): void => {
  const state = arena as unknown as State;
  const cached = state.uniformValues.get(program)?.get(name);
  if (cached?.length === 1 && Object.is(cached[0], value)) return;
  const location = uniformLocation(state, program, name);
  if (location === null) return;
  state.gl.uniform1f(location, value);
  cacheValue(state, program, name, { 0: value, length: 1 }, 1);
};

export const uniform2fv = (
  arena: ProgramArena,
  program: WebGLProgram,
  name: string,
  value: readonly [number, number],
): void => {
  const state = arena as unknown as State;
  const location = prepareVectorUniform(state, program, name, value, 2);
  if (location === undefined) return;
  state.gl.uniform2fv(location, value);
  cacheValue(state, program, name, value, 2);
};

export const uniform2f = (
  arena: ProgramArena,
  program: WebGLProgram,
  name: string,
  x: number,
  y: number,
): void => {
  const state = arena as unknown as State;
  const cached = state.uniformValues.get(program)?.get(name);
  if (cached?.length === 2 && Object.is(cached[0], x) && Object.is(cached[1], y)) return;
  const location = uniformLocation(state, program, name);
  if (location === null) return;
  state.gl.uniform2f(location, x, y);
  cacheValue(state, program, name, { 0: x, 1: y, length: 2 }, 2);
};

const clearState = (state: State): void => {
  delete state.activeProgram;
  delete state.parallel;
  state.requests.clear();
  state.pendingRequests.length = 0;
  state.pendingHead = 0;
  state.uniformLocations.clear();
  state.uniformValues.clear();
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
  for (const locations of state.uniformLocations.values()) uniformLocationCount += locations.size;
  let uniformValueCount = 0;
  for (const values of state.uniformValues.values()) uniformValueCount += values.size;
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
