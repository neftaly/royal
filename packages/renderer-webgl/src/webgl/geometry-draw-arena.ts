import {
  vertexInputBaseVertexArray,
  vertexInputCompositeVertexArrayForInstance,
  type VertexInputArena,
  type VertexInputGeometry,
  type VertexInputInstanceAllocation,
} from "../vertex-input-arena";
import { VERTEX_ATTRIBUTE } from "./vertex-attribute-abi";

declare const authority: unique symbol;
export interface GeometryDrawArena { readonly [authority]: "GeometryDrawArena" }
type Default = { readonly w: number; readonly x: number; readonly y: number; readonly z: number };
type State = { readonly defaults: Map<number, Default>; readonly gl: WebGL2RenderingContext; readonly vertexInputs: VertexInputArena };

export const createGeometryDrawArena = (
  gl: WebGL2RenderingContext,
  vertexInputs: VertexInputArena,
): GeometryDrawArena => ({ defaults: new Map(), gl, vertexInputs } as unknown as GeometryDrawArena);

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

const default4f = (state: State, location: number, x: number, y: number, z: number, w: number): void => {
  const cached = state.defaults.get(location);
  if (cached !== undefined && Object.is(cached.x, x) && Object.is(cached.y, y)
    && Object.is(cached.z, z) && Object.is(cached.w, w)) return;
  state.gl.vertexAttrib4f(location, x, y, z, w);
  state.defaults.set(location, { w, x, y, z });
};

const defaults = (state: State, geometry: VertexInputGeometry): void => {
  if (geometry.tangentBuffer === undefined) default4f(state, VERTEX_ATTRIBUTE.tangent, 0, 0, 0, 0);
  if (geometry.colorBuffer === undefined) default4f(state, VERTEX_ATTRIBUTE.color, 1, 1, 1, 1);
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

export const drawGeometry = (
  arena: GeometryDrawArena,
  contextGeneration: number,
  geometryId: number,
  geometry: VertexInputGeometry,
): void => {
  const state = arena as unknown as State;
  state.gl.bindVertexArray(vertexInputBaseVertexArray(state.vertexInputs, state.gl, contextGeneration, geometryId));
  defaults(state, geometry);
  draw(state, geometry);
};

export const prepareGeometryInstancedDraw = (
  arena: GeometryDrawArena, contextGeneration: number, geometryId: number,
  geometry: VertexInputGeometry, allocation: VertexInputInstanceAllocation,
): void => {
  const state = arena as unknown as State;
  state.gl.bindVertexArray(vertexInputCompositeVertexArrayForInstance(
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
  (arena as unknown as State).defaults.clear();
};
