import type { Mat4 } from "../math/mat4";
import {
  buildClusterGrid,
  createClusterBuildScratch,
  type ClusterGrid,
  type ClusterBuildScratch,
  type ClusteredPunctualLight,
} from "./clustered-lights";
import { DEFAULT_LIGHT_DIRECTION } from "./lights";
import {
  uniform1i,
  uniform2fv,
  uniformColor,
  type ProgramArena,
} from "./program-arena";

export interface ClusteredLightTextureUnits {
  readonly grid: number;
  readonly indices: number;
  readonly lights: number;
}

export interface ClusteredLightArenaSnapshot {
  readonly ownedTextureCount: number;
  readonly resourceCount: number;
  readonly textureUnits: ClusteredLightTextureUnits;
}

declare const authority: unique symbol;
export interface ClusteredLightArena { readonly [authority]: "ClusteredLightArena" }

type MutableTextureUnits = { grid: number; indices: number; lights: number };
type ClusterGridMetadata = Omit<ClusterGrid, "indices" | "offsetsAndCounts">;
type ClusteredLightResource = {
  grid?: ClusterGridMetadata;
  readonly gridTexture: WebGLTexture;
  gridTextureHeight: number;
  gridTextureWidth: number;
  indexData: Uint32Array;
  readonly indexTexture: WebGLTexture;
  indexTextureHeight: number;
  indexTextureWidth: number;
  lastUsedFrame: number;
  lightCount: number;
  lightData: Float32Array;
  lightSnapshot: number[];
  readonly lightTexture: WebGLTexture;
  lightTextureHeight: number;
  projection: number[];
  view: number[];
  viewportHeight: number;
  viewportWidth: number;
};
type State = {
  readonly buildScratch: ClusterBuildScratch;
  readonly gl: WebGL2RenderingContext;
  maxTextureSize: number;
  readonly ownedTextures: Set<WebGLTexture>;
  resource?: ClusteredLightResource;
  readonly textureUnits: MutableTextureUnits;
};

export const createClusteredLightArena = (gl: WebGL2RenderingContext): ClusteredLightArena => ({
  buildScratch: createClusterBuildScratch(),
  gl,
  maxTextureSize: 0,
  ownedTextures: new Set(),
  textureUnits: { grid: -1, indices: -1, lights: -1 },
} as unknown as ClusteredLightArena);

export const configureClusteredLightArena = (
  arena: ClusteredLightArena,
  maxTextureImageUnits: number,
  maxTextureSize: number,
): void => {
  const state = arena as unknown as State;
  state.maxTextureSize = Number.isFinite(maxTextureSize) ? maxTextureSize : 0;
  if (maxTextureImageUnits >= 8) {
    state.textureUnits.grid = maxTextureImageUnits - 3;
    state.textureUnits.indices = maxTextureImageUnits - 2;
    state.textureUnits.lights = maxTextureImageUnits - 1;
  } else {
    state.textureUnits.grid = -1;
    state.textureUnits.indices = -1;
    state.textureUnits.lights = -1;
  }
};

export const clusteredLightTextureUnits = (
  arena: ClusteredLightArena,
): ClusteredLightTextureUnits => (arena as unknown as State).textureUnits;

const createTexture = (state: State): WebGLTexture => {
  const texture = state.gl.createTexture();
  if (texture === null) throw new Error("WebGL texture creation failed");
  state.ownedTextures.add(texture);
  return texture;
};

const createResource = (state: State): ClusteredLightResource => {
  const created: WebGLTexture[] = [];
  try {
    const gridTexture = createTexture(state);
    created.push(gridTexture);
    const indexTexture = createTexture(state);
    created.push(indexTexture);
    const lightTexture = createTexture(state);
    created.push(lightTexture);
    return {
      gridTexture, gridTextureHeight: 0, gridTextureWidth: 0,
      indexData: new Uint32Array(0), indexTexture, indexTextureHeight: 0, indexTextureWidth: 0,
      lastUsedFrame: -1, lightCount: 0, lightData: new Float32Array(0), lightSnapshot: [],
      lightTexture, lightTextureHeight: 0,
      projection: Array.from({ length: 16 }, () => Number.NaN),
      view: Array.from({ length: 16 }, () => Number.NaN),
      viewportHeight: 0, viewportWidth: 0,
    };
  } catch (error) {
    for (const texture of created) {
      try {
        state.gl.deleteTexture(texture);
        state.ownedTextures.delete(texture);
      } catch { /* Preserve the creation failure and retain the handle for teardown retry. */ }
    }
    throw error;
  }
};

const matrixMatches = (left: readonly number[], right: Mat4): boolean => {
  for (let index = 0; index < 16; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
};

const snapshotMatches = (
  resource: ClusteredLightResource,
  lights: readonly ClusteredPunctualLight[],
): boolean => {
  if (resource.lightCount !== lights.length) return false;
  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index]!;
    const offset = index * 14;
    const direction = light.kind === "point" ? DEFAULT_LIGHT_DIRECTION : light.direction;
    const values = resource.lightSnapshot;
    if (
      !Object.is(values[offset], light.kind === "point" ? 1 : 2)
      || !Object.is(values[offset + 1], light.color[0])
      || !Object.is(values[offset + 2], light.color[1])
      || !Object.is(values[offset + 3], light.color[2])
      || !Object.is(values[offset + 4], light.position[0])
      || !Object.is(values[offset + 5], light.position[1])
      || !Object.is(values[offset + 6], light.position[2])
      || !Object.is(values[offset + 7], light.range === undefined ? 0 : 1)
      || !Object.is(values[offset + 8], light.range ?? 0)
      || !Object.is(values[offset + 9], direction[0])
      || !Object.is(values[offset + 10], direction[1])
      || !Object.is(values[offset + 11], direction[2])
      || !Object.is(values[offset + 12], light.kind === "spot" ? light.innerConeAngle : 0)
      || !Object.is(values[offset + 13], light.kind === "spot" ? light.outerConeAngle : 0)
    ) return false;
  }
  return true;
};

const commitSnapshot = (
  resource: ClusteredLightResource,
  lights: readonly ClusteredPunctualLight[],
): void => {
  resource.lightCount = lights.length;
  resource.lightSnapshot.length = lights.length * 14;
  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index]!;
    const offset = index * 14;
    const direction = light.kind === "point" ? DEFAULT_LIGHT_DIRECTION : light.direction;
    resource.lightSnapshot[offset] = light.kind === "point" ? 1 : 2;
    resource.lightSnapshot[offset + 1] = light.color[0];
    resource.lightSnapshot[offset + 2] = light.color[1];
    resource.lightSnapshot[offset + 3] = light.color[2];
    resource.lightSnapshot[offset + 4] = light.position[0];
    resource.lightSnapshot[offset + 5] = light.position[1];
    resource.lightSnapshot[offset + 6] = light.position[2];
    resource.lightSnapshot[offset + 7] = light.range === undefined ? 0 : 1;
    resource.lightSnapshot[offset + 8] = light.range ?? 0;
    resource.lightSnapshot[offset + 9] = direction[0];
    resource.lightSnapshot[offset + 10] = direction[1];
    resource.lightSnapshot[offset + 11] = direction[2];
    resource.lightSnapshot[offset + 12] = light.kind === "spot" ? light.innerConeAngle : 0;
    resource.lightSnapshot[offset + 13] = light.kind === "spot" ? light.outerConeAngle : 0;
  }
};

const upload = (
  state: State,
  resource: ClusteredLightResource,
  grid: ClusterGrid,
  lights: readonly ClusteredPunctualLight[],
  uploadLightData: boolean,
): void => {
  const gl = state.gl;
  const units = state.textureUnits;
  if (lights.length > state.maxTextureSize) {
    throw new Error(`Clustered light count ${lights.length} exceeds MAX_TEXTURE_SIZE ${state.maxTextureSize}`);
  }
  const gridWidth = grid.tileCountX * grid.tileCountY;
  if (gridWidth > state.maxTextureSize || grid.zSliceCount > state.maxTextureSize) {
    throw new Error(
      `Clustered light grid ${gridWidth}x${grid.zSliceCount} exceeds MAX_TEXTURE_SIZE ${state.maxTextureSize}`,
    );
  }
  const configure = (unit: number, texture: WebGLTexture): void => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  configure(units.grid, resource.gridTexture);
  if (
    resource.gridTextureWidth === gridWidth
    && resource.gridTextureHeight === grid.zSliceCount
    && typeof gl.texSubImage2D === "function"
  ) {
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, gridWidth, grid.zSliceCount,
      gl.RG_INTEGER, gl.UNSIGNED_INT, grid.offsetsAndCounts,
    );
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RG32UI, gridWidth, grid.zSliceCount, 0,
      gl.RG_INTEGER, gl.UNSIGNED_INT, grid.offsetsAndCounts,
    );
    resource.gridTextureWidth = gridWidth;
    resource.gridTextureHeight = grid.zSliceCount;
  }

  const requiredIndexCount = Math.max(1, grid.indexCount);
  const resizedIndexTexture = resource.indexData.length < requiredIndexCount;
  let indexTextureWidth = resource.indexTextureWidth;
  let indexTextureHeight = resource.indexTextureHeight;
  let indexData = resource.indexData;
  if (resizedIndexTexture) {
    const capacity = 2 ** Math.ceil(Math.log2(requiredIndexCount));
    indexTextureWidth = Math.min(state.maxTextureSize, capacity);
    indexTextureHeight = Math.ceil(capacity / indexTextureWidth);
    if (indexTextureHeight > state.maxTextureSize) {
      throw new Error(`Clustered light index table exceeds MAX_TEXTURE_SIZE ${state.maxTextureSize}`);
    }
    indexData = new Uint32Array(indexTextureWidth * indexTextureHeight);
  }
  if (indexTextureHeight > state.maxTextureSize) {
    throw new Error(`Clustered light index table exceeds MAX_TEXTURE_SIZE ${state.maxTextureSize}`);
  }
  indexData.fill(0);
  for (let index = 0; index < grid.indexCount; index += 1) indexData[index] = grid.indices[index]!;
  configure(units.indices, resource.indexTexture);
  if (!resizedIndexTexture && typeof gl.texSubImage2D === "function") {
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, indexTextureWidth, indexTextureHeight,
      gl.RED_INTEGER, gl.UNSIGNED_INT, indexData,
    );
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32UI, indexTextureWidth, indexTextureHeight, 0,
      gl.RED_INTEGER, gl.UNSIGNED_INT, indexData,
    );
  }
  resource.indexTextureWidth = indexTextureWidth;
  resource.indexTextureHeight = indexTextureHeight;
  resource.indexData = indexData;
  if (!uploadLightData) return;

  const requiredLightCount = Math.max(lights.length, 1);
  const resizedLightTexture = resource.lightTextureHeight < requiredLightCount;
  let lightTextureHeight = resource.lightTextureHeight;
  let lightData = resource.lightData;
  if (resizedLightTexture) {
    lightTextureHeight = Math.min(
      state.maxTextureSize,
      2 ** Math.ceil(Math.log2(requiredLightCount)),
    );
    lightData = new Float32Array(lightTextureHeight * 16);
  } else lightData.fill(0);
  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index]!;
    const offset = index * 16;
    const direction = light.kind === "point" ? DEFAULT_LIGHT_DIRECTION : light.direction;
    lightData[offset] = light.color[0];
    lightData[offset + 1] = light.color[1];
    lightData[offset + 2] = light.color[2];
    lightData[offset + 3] = light.kind === "point" ? 1 : 2;
    lightData[offset + 4] = light.position[0];
    lightData[offset + 5] = light.position[1];
    lightData[offset + 6] = light.position[2];
    lightData[offset + 7] = light.range ?? 0;
    lightData[offset + 8] = direction[0];
    lightData[offset + 9] = direction[1];
    lightData[offset + 10] = direction[2];
    lightData[offset + 11] = light.kind === "spot" ? Math.cos(light.innerConeAngle) : 1;
    lightData[offset + 12] = light.kind === "spot" ? Math.cos(light.outerConeAngle) : 0;
  }
  configure(units.lights, resource.lightTexture);
  if (!resizedLightTexture && typeof gl.texSubImage2D === "function") {
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, 4, lightTextureHeight,
      gl.RGBA, gl.FLOAT, lightData,
    );
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, 4, lightTextureHeight, 0,
      gl.RGBA, gl.FLOAT, lightData,
    );
  }
  resource.lightTextureHeight = lightTextureHeight;
  resource.lightData = lightData;
  commitSnapshot(resource, lights);
};

export const bindClusteredLights = (
  arena: ClusteredLightArena,
  programArena: ProgramArena,
  program: WebGLProgram,
  lights: readonly ClusteredPunctualLight[],
  projection: Mat4,
  view: Mat4,
  width: number,
  height: number,
  frame: number,
): void => {
  const state = arena as unknown as State;
  if (lights.length === 0) {
    uniform1i(programArena, program, "u_useClusteredLights", 0);
    return;
  }
  const units = state.textureUnits;
  if (units.grid < 0 || units.indices < 0 || units.lights < 0) {
    throw new Error("Clustered Forward+ lighting requires three fragment texture units");
  }
  const perspective = Math.abs(projection[15]) < 0.5;
  const near = Math.abs(perspective
    ? projection[14] / (projection[10] - 1)
    : (projection[14] + 1) / projection[10]);
  const far = Math.abs(perspective
    ? projection[14] / (projection[10] + 1)
    : (projection[14] - 1) / projection[10]);
  let resource = state.resource;
  if (resource === undefined) {
    resource = createResource(state);
    state.resource = resource;
  }
  const lightsChanged = !snapshotMatches(resource, lights);
  const viewChanged = resource.grid === undefined
    || !matrixMatches(resource.projection, projection)
    || !matrixMatches(resource.view, view)
    || resource.viewportWidth !== width
    || resource.viewportHeight !== height;
  let grid = resource.grid;
  if (lightsChanged || viewChanged) {
    const builtGrid = buildClusterGrid({
      camera: { far, kind: perspective ? "perspective-camera" : "orthographic-camera", near },
      height, lights, projection, view, width,
    }, state.buildScratch);
    upload(state, resource, builtGrid, lights, lightsChanged);
    const { indices: _indices, offsetsAndCounts: _offsetsAndCounts, ...metadata } = builtGrid;
    grid = metadata;
    resource.grid = metadata;
    for (let index = 0; index < 16; index += 1) {
      resource.projection[index] = projection[index]!;
      resource.view[index] = view[index]!;
    }
    resource.viewportWidth = width;
    resource.viewportHeight = height;
    resource.lastUsedFrame = frame;
  } else resource.lastUsedFrame = frame;
  if (grid === undefined) throw new Error("Clustered light grid was not prepared");

  const gl = state.gl;
  gl.activeTexture(gl.TEXTURE0 + units.grid);
  gl.bindTexture(gl.TEXTURE_2D, resource.gridTexture);
  gl.activeTexture(gl.TEXTURE0 + units.indices);
  gl.bindTexture(gl.TEXTURE_2D, resource.indexTexture);
  gl.activeTexture(gl.TEXTURE0 + units.lights);
  gl.bindTexture(gl.TEXTURE_2D, resource.lightTexture);
  uniform1i(programArena, program, "u_useClusteredLights", 1);
  uniform1i(programArena, program, "u_clusterGrid", units.grid);
  uniform1i(programArena, program, "u_clusterLightIndices", units.indices);
  uniform1i(programArena, program, "u_clusterLightData", units.lights);
  uniformColor(programArena, program, "u_clusterDimensions", [
    grid.tileCountX, grid.tileCountY, grid.zSliceCount, grid.tileSize,
  ]);
  uniformColor(programArena, program, "u_clusterDepth", [grid.zSliceScale, grid.zSliceBias, near, 0]);
  uniform2fv(programArena, program, "u_clusterProjection", [perspective ? 0 : 1, resource.indexTextureWidth]);
  uniform2fv(programArena, program, "u_clusterViewportOrigin", [0, 0]);
};

/** The sequential cache currently owns at most one triple; retain the frame hook as its eviction boundary. */
export const endClusteredLightFrame = (_arena: ClusteredLightArena, _frame: number): void => {};

const clear = (state: State): void => {
  delete state.resource;
  state.ownedTextures.clear();
};

export const releaseClusteredLightContextHandles = (arena: ClusteredLightArena): void => {
  const state = arena as unknown as State;
  delete state.resource;
  let error: unknown;
  for (const texture of Array.from(state.ownedTextures)) {
    try {
      state.gl.deleteTexture(texture);
      state.ownedTextures.delete(texture);
    } catch (caught) {
      error ??= caught;
    }
  }
  if (error !== undefined) throw error;
};

export const dropClusteredLightContext = (arena: ClusteredLightArena): void => {
  clear(arena as unknown as State);
};

export const clusteredLightArenaSnapshot = (arena: ClusteredLightArena): ClusteredLightArenaSnapshot => {
  const state = arena as unknown as State;
  return {
    ownedTextureCount: state.ownedTextures.size,
    resourceCount: state.resource === undefined ? 0 : 1,
    textureUnits: state.textureUnits,
  };
};
