import {
  vertexInputBaseVertexArrayForGeometry,
  vertexInputCompositeVertexArrayForInstance,
  type VertexInputArena,
  type VertexInputGeometry,
  type VertexInputInstanceAllocation,
} from "../vertex-input/arena";
import { VERTEX_ATTRIBUTE } from "../vertex-input/attribute-abi";

declare const authority: unique symbol;
export interface GeometryDrawArena { readonly [authority]: "GeometryDrawArena" }
type State = {
  activeVertexArray?: WebGLVertexArrayObject;
  initializedDefaults: number;
  readonly gl: WebGL2RenderingContext;
  readonly vertexInputs: VertexInputArena;
};

const TANGENT_DEFAULT_INITIALIZED = 1 << 0;
const COLOR_DEFAULT_INITIALIZED = 1 << 1;

export const createGeometryDrawArena = (
  gl: WebGL2RenderingContext,
  vertexInputs: VertexInputArena,
): GeometryDrawArena => ({
  gl,
  initializedDefaults: 0,
  vertexInputs,
} as unknown as GeometryDrawArena);

const mode = (gl: WebGL2RenderingContext, value: VertexInputGeometry["mode"]): number => {
  switch (value) {
    case "line-loop": return gl.LINE_LOOP;
    case "line-strip": return gl.LINE_STRIP;
    case "lines": return gl.LINES;
    case "points": return gl.POINTS;
    case "triangle-fan": return gl.TRIANGLE_FAN;
    case "triangle-strip": return gl.TRIANGLE_STRIP;
    case "triangles": return gl.TRIANGLES;
  }
};

const defaults = (state: State, geometry: VertexInputGeometry): void => {
  let initialized = state.initializedDefaults;
  if (geometry.tangentBuffer === undefined && (initialized & TANGENT_DEFAULT_INITIALIZED) === 0) {
    state.gl.vertexAttrib4f(VERTEX_ATTRIBUTE.tangent, 0, 0, 0, 0);
    initialized |= TANGENT_DEFAULT_INITIALIZED;
  }
  if (geometry.colorBuffer === undefined && (initialized & COLOR_DEFAULT_INITIALIZED) === 0) {
    state.gl.vertexAttrib4f(VERTEX_ATTRIBUTE.color, 1, 1, 1, 1);
    initialized |= COLOR_DEFAULT_INITIALIZED;
  }
  state.initializedDefaults = initialized;
};

const draw = (state: State, geometry: VertexInputGeometry, instanceCount?: number): void => {
  const glMode = mode(state.gl, geometry.mode);
  if (instanceCount === undefined) {
    if (geometry.indexBuffer === undefined || geometry.indexType === undefined) state.gl.drawArrays(glMode, 0, geometry.drawCount);
    else state.gl.drawElements(glMode, geometry.drawCount, geometry.indexType, 0);
  } else if (geometry.indexBuffer === undefined || geometry.indexType === undefined) {
    state.gl.drawArraysInstanced(glMode, 0, geometry.drawCount, instanceCount);
  } else state.gl.drawElementsInstanced(glMode, geometry.drawCount, geometry.indexType, 0, instanceCount);
};

const bindVertexArray = (state: State, vertexArray: WebGLVertexArrayObject): void => {
  if (state.activeVertexArray === vertexArray) return;
  state.gl.bindVertexArray(vertexArray);
  state.activeVertexArray = vertexArray;
};

/** Invalidates the VAO cache after non-geometry passes may have changed it. */
export const beginGeometryDrawFrame = (arena: GeometryDrawArena): void => {
  delete (arena as unknown as State).activeVertexArray;
};

export const drawGeometry = (
  arena: GeometryDrawArena,
  contextGeneration: number,
  geometry: VertexInputGeometry,
): void => {
  const state = arena as unknown as State;
  bindVertexArray(state, vertexInputBaseVertexArrayForGeometry(
    state.vertexInputs,
    state.gl,
    contextGeneration,
    geometry,
  ));
  defaults(state, geometry);
  draw(state, geometry);
};

export const prepareGeometryInstancedDraw = (
  arena: GeometryDrawArena, contextGeneration: number, geometryId: number,
  geometry: VertexInputGeometry, allocation: VertexInputInstanceAllocation,
): void => {
  const state = arena as unknown as State;
  bindVertexArray(state, vertexInputCompositeVertexArrayForInstance(
    state.vertexInputs, state.gl, contextGeneration, geometryId, allocation,
  ));
  defaults(state, geometry);
};

export const submitGeometryInstancedDraw = (
  arena: GeometryDrawArena,
  geometry: VertexInputGeometry,
  instanceCount: number,
): void => {
  draw(arena as unknown as State, geometry, instanceCount);
};

export const clearGeometryDrawArenaContext = (arena: GeometryDrawArena): void => {
  const state = arena as unknown as State;
  delete state.activeVertexArray;
  state.initializedDefaults = 0;
};
