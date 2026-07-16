import type { Mat4 } from "../math/mat4";
import type { SurfacePointLight, SurfaceSpotLight } from "./lights";

export type ClusteredPunctualLight = SurfacePointLight | SurfaceSpotLight;

export type ClusterGrid = {
  readonly clusterCount: number;
  readonly indices: Uint32Array;
  readonly indexCount: number;
  readonly offsetsAndCounts: Uint32Array;
  readonly tileCountX: number;
  readonly tileCountY: number;
  readonly tileSize: number;
  readonly zSliceCount: number;
  readonly zSliceScale: number;
  readonly zSliceBias: number;
};

export type ClusterBuildScratch = {
  bounds: Int32Array;
  counts: Uint32Array;
  indices: Uint32Array;
  offsetsAndCounts: Uint32Array;
};

export const createClusterBuildScratch = (): ClusterBuildScratch => ({
  bounds: new Int32Array(0),
  counts: new Uint32Array(0),
  indices: new Uint32Array(0),
  offsetsAndCounts: new Uint32Array(0),
});

const capacity = (length: number): number => length <= 1 ? length : 2 ** Math.ceil(Math.log2(length));

const ensureInt32 = (values: Int32Array, length: number): Int32Array =>
  values.length >= length ? values : new Int32Array(capacity(length));

const ensureUint32 = (values: Uint32Array, length: number): Uint32Array =>
  values.length >= length ? values : new Uint32Array(capacity(length));

export type BuildClusterGridOptions = {
  readonly camera: { readonly far: number; readonly kind: "orthographic-camera" | "perspective-camera"; readonly near: number };
  readonly height: number;
  readonly lights: readonly ClusteredPunctualLight[];
  readonly projection: Mat4;
  readonly tileSize?: number;
  readonly view: Mat4;
  readonly width: number;
  readonly zSliceCount?: number;
};

const DEFAULT_TILE_SIZE = 64;
const DEFAULT_Z_SLICE_COUNT = 16;
const MIN_LIGHT_ILLUMINANCE_LUX = 0.01;
const MAX_LIGHTS_PER_CLUSTER = 4096;
const MAX_CLUSTER_INDEX_BYTES = 64 * 1024 * 1024;

export interface ClusterBuildScratchCapacity {
  readonly bounds: number;
  readonly counts: number;
  readonly indices: number;
  readonly offsetsAndCounts: number;
}

/** Pure conservative capacity bound used to obtain admission before allocating build scratch. */
export const clusterBuildScratchCapacity = (
  width: number,
  height: number,
  lightCount: number,
): ClusterBuildScratchCapacity => {
  const tileCountX = Math.max(1, Math.ceil(width / DEFAULT_TILE_SIZE));
  const tileCountY = Math.max(1, Math.ceil(height / DEFAULT_TILE_SIZE));
  const clusterCount = tileCountX * tileCountY * DEFAULT_Z_SLICE_COUNT;
  const indexLimit = MAX_CLUSTER_INDEX_BYTES / Uint32Array.BYTES_PER_ELEMENT;
  const indexUpperBound = Math.min(indexLimit, clusterCount * Math.min(lightCount, MAX_LIGHTS_PER_CLUSTER));
  return {
    bounds: capacity(lightCount * 6),
    counts: capacity(clusterCount),
    indices: capacity(indexUpperBound),
    offsetsAndCounts: capacity(clusterCount * 2),
  };
};

export const createClusterBuildScratchWithCapacity = (
  value: ClusterBuildScratchCapacity,
): ClusterBuildScratch => ({
  bounds: new Int32Array(value.bounds),
  counts: new Uint32Array(value.counts),
  indices: new Uint32Array(value.indices),
  offsetsAndCounts: new Uint32Array(value.offsetsAndCounts),
});

const clampInteger = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, Math.floor(value)));

const depthSlice = (
  depth: number,
  logarithmic: boolean,
  near: number,
  scale: number,
  bias: number,
  count: number,
): number => clampInteger(
  logarithmic ? Math.log2(Math.max(depth, near)) * scale + bias : depth * scale + bias,
  0,
  count - 1,
);

const lightRadius = (light: ClusteredPunctualLight, far: number): number => {
  if (light.range !== undefined) return Math.min(light.range, far);
  const peakCandela = Math.max(light.color[0], light.color[1], light.color[2], 0);
  return Math.min(Math.sqrt(peakCandela / MIN_LIGHT_ILLUMINANCE_LUX), far);
};

export const buildClusterGrid = ({
  camera,
  height,
  lights,
  projection,
  tileSize = DEFAULT_TILE_SIZE,
  view,
  width,
  zSliceCount = DEFAULT_Z_SLICE_COUNT,
}: BuildClusterGridOptions, scratch = createClusterBuildScratch()): ClusterGrid => {
  if (!Number.isInteger(tileSize) || tileSize <= 0) throw new Error("cluster tileSize must be a positive integer");
  if (!Number.isInteger(zSliceCount) || zSliceCount <= 0) throw new Error("cluster zSliceCount must be positive");
  const tileCountX = Math.max(1, Math.ceil(width / tileSize));
  const tileCountY = Math.max(1, Math.ceil(height / tileSize));
  const clusterCount = tileCountX * tileCountY * zSliceCount;
  const near = Math.max(Math.abs(camera.near), 0.001);
  const far = Math.max(Math.abs(camera.far), near + 0.001);
  const logarithmicDepth = camera.kind === "perspective-camera";
  const zSliceScale = logarithmicDepth ? zSliceCount / Math.log2(far / near) : zSliceCount / (far - near);
  const zSliceBias = logarithmicDepth ? -Math.log2(near) * zSliceScale : -near * zSliceScale;
  scratch.bounds = ensureInt32(scratch.bounds, lights.length * 6);
  scratch.counts = ensureUint32(scratch.counts, clusterCount);
  scratch.offsetsAndCounts = ensureUint32(scratch.offsetsAndCounts, clusterCount * 2);
  const bounds = scratch.bounds;
  const counts = scratch.counts;
  const offsetsAndCounts = scratch.offsetsAndCounts;
  bounds.fill(-1, 0, lights.length * 6);
  counts.fill(0, 0, clusterCount);

  for (let lightIndex = 0; lightIndex < lights.length; lightIndex += 1) {
    const light = lights[lightIndex]!;
    const [lightX, lightY, lightZ] = light.position;
    const positionX = view[0] * lightX + view[4] * lightY + view[8] * lightZ + view[12];
    const positionY = view[1] * lightX + view[5] * lightY + view[9] * lightZ + view[13];
    const positionZ = view[2] * lightX + view[6] * lightY + view[10] * lightZ + view[14];
    const depth = -positionZ;
    const radius = lightRadius(light, far);
    if (!(radius > 0) || depth + radius < near || depth - radius > far) continue;
    const crossesNearPlane = depth - radius <= near;
    const clipX = projection[0] * positionX + projection[4] * positionY + projection[8] * positionZ + projection[12];
    const clipY = projection[1] * positionX + projection[5] * positionY + projection[9] * positionZ + projection[13];
    const clipW = projection[3] * positionX + projection[7] * positionY + projection[11] * positionZ + projection[15];
    if (clipW === 0 && !crossesNearPlane) continue;
    const ndcX = clipW === 0 ? 0 : clipX / clipW;
    const ndcY = clipW === 0 ? 0 : clipY / clipW;
    const denominator = logarithmicDepth ? Math.max(depth - radius, near) : 1;
    const radiusX = Math.abs(projection[0] * radius / denominator);
    const radiusY = Math.abs(projection[5] * radius / denominator);
    const minX = crossesNearPlane
      ? 0
      : clampInteger(((ndcX - radiusX) * 0.5 + 0.5) * tileCountX, 0, tileCountX - 1);
    const maxX = crossesNearPlane
      ? tileCountX - 1
      : clampInteger(((ndcX + radiusX) * 0.5 + 0.5) * tileCountX, 0, tileCountX - 1);
    const minY = crossesNearPlane
      ? 0
      : clampInteger(((ndcY - radiusY) * 0.5 + 0.5) * tileCountY, 0, tileCountY - 1);
    const maxY = crossesNearPlane
      ? tileCountY - 1
      : clampInteger(((ndcY + radiusY) * 0.5 + 0.5) * tileCountY, 0, tileCountY - 1);
    const minZ = depthSlice(Math.max(depth - radius, near), logarithmicDepth, near, zSliceScale, zSliceBias, zSliceCount);
    const maxZ = depthSlice(Math.min(depth + radius, far), logarithmicDepth, near, zSliceScale, zSliceBias, zSliceCount);
    const boundsOffset = lightIndex * 6;
    bounds[boundsOffset] = minX;
    bounds[boundsOffset + 1] = maxX;
    bounds[boundsOffset + 2] = minY;
    bounds[boundsOffset + 3] = maxY;
    bounds[boundsOffset + 4] = minZ;
    bounds[boundsOffset + 5] = maxZ;
    for (let z = minZ; z <= maxZ; z += 1) for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) counts[x + y * tileCountX + z * tileCountX * tileCountY]! += 1;
    }
  }

  let indexCount = 0;
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    if (counts[cluster]! > MAX_LIGHTS_PER_CLUSTER) {
      throw new Error(`cluster ${cluster} contains ${counts[cluster]} lights, exceeding the ${MAX_LIGHTS_PER_CLUSTER} safety budget`);
    }
    offsetsAndCounts[cluster * 2] = indexCount;
    offsetsAndCounts[cluster * 2 + 1] = counts[cluster]!;
    indexCount += counts[cluster]!;
    if (indexCount * Uint32Array.BYTES_PER_ELEMENT > MAX_CLUSTER_INDEX_BYTES) {
      throw new Error(`cluster light indices exceed the ${MAX_CLUSTER_INDEX_BYTES} byte safety budget`);
    }
  }
  scratch.indices = ensureUint32(scratch.indices, indexCount);
  const indices = scratch.indices;
  counts.fill(0, 0, clusterCount);
  for (let lightIndex = 0; lightIndex < lights.length; lightIndex += 1) {
    const offset = lightIndex * 6;
    const minX = bounds[offset]!;
    if (minX < 0) continue;
    const maxX = bounds[offset + 1]!;
    const minY = bounds[offset + 2]!;
    const maxY = bounds[offset + 3]!;
    const minZ = bounds[offset + 4]!;
    const maxZ = bounds[offset + 5]!;
    for (let z = minZ; z <= maxZ; z += 1) for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const cluster = x + y * tileCountX + z * tileCountX * tileCountY;
        indices[offsetsAndCounts[cluster * 2]! + counts[cluster]!] = lightIndex;
        counts[cluster]! += 1;
      }
    }
  }
  return { clusterCount, indices, indexCount, offsetsAndCounts, tileCountX, tileCountY, tileSize, zSliceCount, zSliceScale, zSliceBias };
};
