import type { Mat4 } from "../math/mat4";
import type { ClusterGrid, ClusteredPunctualLight } from "./clustered-lights";
import { DEFAULT_LIGHT_DIRECTION } from "./lights";

export type ClusterGridMetadata = Omit<ClusterGrid, "indices" | "offsetsAndCounts">;

export type ClusteredLightResource = {
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

export type ClusteredLightCache = Map<string, ClusteredLightResource[]>;

const SHARED_SEQUENTIAL_RESOURCE_KEY = "shared-sequential";

const matrixMatches = (left: readonly number[], right: Mat4): boolean => {
  for (let index = 0; index < 16; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
};

export const clusteredLightSnapshotMatches = (
  candidate: ClusteredLightResource,
  lights: readonly ClusteredPunctualLight[],
): boolean => {
  if (candidate.lightCount !== lights.length) return false;
  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index]!;
    const offset = index * 14;
    const direction = light.kind === "point" ? DEFAULT_LIGHT_DIRECTION : light.direction;
    const values = candidate.lightSnapshot;
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

export const selectClusteredLightResource = (
  cache: ClusteredLightCache,
  input: {
    readonly createTexture: () => WebGLTexture;
    readonly frame: number;
    readonly height: number;
    readonly lights: readonly ClusteredPunctualLight[];
    readonly projection: Mat4;
    readonly view: Mat4;
    readonly width: number;
  },
): { readonly lightsChanged: boolean; readonly resource: ClusteredLightResource; readonly viewChanged: boolean } => {
  const resources = cache.get(SHARED_SEQUENTIAL_RESOURCE_KEY) ?? [];
  if (!cache.has(SHARED_SEQUENTIAL_RESOURCE_KEY)) {
    cache.set(SHARED_SEQUENTIAL_RESOURCE_KEY, resources);
  }
  // WebGL commands consume texture contents in submission order. One explicit
  // resource triple can therefore be rewritten between sequential draws; no
  // light set needs frame-long texture ownership.
  let resource = resources[0];
  if (resource === undefined) {
    resource = {
      gridTexture: input.createTexture(), gridTextureHeight: 0, gridTextureWidth: 0,
      indexData: new Uint32Array(0), indexTexture: input.createTexture(), indexTextureHeight: 0, indexTextureWidth: 0,
      lastUsedFrame: -1, lightCount: 0, lightData: new Float32Array(0), lightSnapshot: [],
      lightTexture: input.createTexture(), lightTextureHeight: 0,
      projection: Array.from({ length: 16 }, () => Number.NaN),
      view: Array.from({ length: 16 }, () => Number.NaN),
      viewportHeight: 0, viewportWidth: 0,
    };
    resources.push(resource);
  }
  return {
    lightsChanged: !clusteredLightSnapshotMatches(resource, input.lights),
    resource,
    viewChanged: resource.grid === undefined
      || !matrixMatches(resource.projection, input.projection)
      || !matrixMatches(resource.view, input.view)
      || resource.viewportWidth !== input.width
      || resource.viewportHeight !== input.height,
  };
};

export const commitClusteredLightView = (
  resource: ClusteredLightResource,
  input: { readonly frame: number; readonly grid: ClusterGridMetadata; readonly height: number; readonly projection: Mat4; readonly view: Mat4; readonly width: number },
): void => {
  resource.grid = input.grid;
  for (let index = 0; index < 16; index += 1) {
    resource.projection[index] = input.projection[index]!;
    resource.view[index] = input.view[index]!;
  }
  resource.viewportWidth = input.width;
  resource.viewportHeight = input.height;
  resource.lastUsedFrame = input.frame;
};

export const markClusteredLightResourceUsed = (resource: ClusteredLightResource, frame: number): void => {
  resource.lastUsedFrame = frame;
};

export const commitClusteredLightSnapshot = (
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

export const pruneClusteredLightCache = (
  cache: ClusteredLightCache,
  frame: number,
  releaseTexture: (texture: WebGLTexture) => void,
  maximumCachedResources = 16,
): void => {
  let retained = 0;
  for (const resources of cache.values()) retained += resources.length;
  if (retained <= maximumCachedResources) return;
  const entries = [...cache.entries()].flatMap(([key, resources]) =>
    resources.map((resource) => ({ key, resource })));
  const removable = entries
    .filter(({ resource }) => resource.lastUsedFrame !== frame)
    .sort((left, right) => left.resource.lastUsedFrame - right.resource.lastUsedFrame);
  for (const { key, resource } of removable) {
    if (retained <= maximumCachedResources) break;
    const resources = cache.get(key);
    if (resources === undefined) continue;
    const index = resources.indexOf(resource);
    if (index < 0) continue;
    resources.splice(index, 1);
    releaseTexture(resource.gridTexture);
    releaseTexture(resource.indexTexture);
    releaseTexture(resource.lightTexture);
    if (resources.length === 0) cache.delete(key);
    retained -= 1;
  }
};
