import { multiplyMat4 } from "./math/mat4";
import type { TextureSamplerWrap } from "@royal/renderer-core";
import {
  createVirtualTextureCoverageProvider,
  queryVirtualTextureCoverage,
  type VirtualTextureCoverageGeometry,
  type VirtualTextureCoverageQuery,
} from "./virtual-texture-coverage-provider";
import {
  VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW,
  virtualTextureDemandPageDistance,
  type VirtualTextureDrawDemand,
  type VirtualTextureDrawDemandContext,
  type VirtualTextureDrawDemandModelSource,
  type VirtualTextureScreenFootprint,
  type ViewportSize,
} from "./virtual-texture-runtime";
import {
  derivedVirtualTextureMipCount,
  virtualTextureMipDimension,
  virtualTexturePageKey,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
} from "./virtual-texturing";

export type VirtualTextureProjection =
  | { readonly kind: "indeterminate" }
  | { readonly kind: "not-visible" }
  | { readonly footprint: VirtualTextureScreenFootprint; readonly kind: "visible" };

export type VirtualTextureDemandSource = {
  readonly availablePageKeys?: ReadonlySet<string>;
  readonly manifest: VirtualTextureManifestModel;
};

export type VirtualTextureDrawDemandInput = VirtualTextureDemandSource & {
  readonly context?: VirtualTextureDrawDemandContext;
  readonly limit?: number;
  readonly workspace?: VirtualTextureDemandPlanningWorkspace;
};

const demandLimit = (limit: number | undefined): number =>
  Number.isSafeInteger(limit) && limit !== undefined && limit >= 0
    ? limit
    : VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW;

export const virtualTextureDemandModelCount = (source: VirtualTextureDrawDemandModelSource): number => {
  switch (source.kind) {
    case "single":
      return 1;
    case "composed":
      if (source.localModels.length !== source.rootModels.length) {
        throw new Error("Virtual texture composed model arrays must have matching lengths");
      }
      return source.localModels.length;
  }
};

const CLIPPED_VERTEX_COMPONENTS = 6;
const CLIPPED_POLYGON_CAPACITY = 12;
const FINEST_REGION_CAPACITY = 4;
// minU, maxU, minV, maxV, maximum screen width/height, maximum observed area.
const FINEST_REGION_COMPONENTS = 7;
const RETAINED_POLYGON_COMPONENT_CAPACITY = 32_768;
const RETAINED_POLYGON_CAPACITY = 4_096;

export type VirtualTextureDemandPlanningWorkspace = {
  readonly clippedPolygonA: Float64Array;
  readonly clippedPolygonB: Float64Array;
  readonly wrappedPolygon: Float64Array;
  readonly finestRegionComponents: Float64Array;
  finestRegionCount: number;
  readonly finestRegionMips: Uint32Array;
  overflowed: boolean;
  readonly visiblePolygonComponents: Float64Array;
  visiblePolygonComponentCount: number;
  visiblePolygonCount: number;
  readonly visiblePolygonOffsets: Uint32Array;
};

export const createVirtualTextureDemandPlanningWorkspace = (): VirtualTextureDemandPlanningWorkspace => ({
  clippedPolygonA: new Float64Array(CLIPPED_VERTEX_COMPONENTS * CLIPPED_POLYGON_CAPACITY),
  clippedPolygonB: new Float64Array(CLIPPED_VERTEX_COMPONENTS * CLIPPED_POLYGON_CAPACITY),
  wrappedPolygon: new Float64Array(CLIPPED_VERTEX_COMPONENTS * CLIPPED_POLYGON_CAPACITY),
  finestRegionComponents: new Float64Array(FINEST_REGION_CAPACITY * FINEST_REGION_COMPONENTS),
  finestRegionCount: 0,
  finestRegionMips: new Uint32Array(FINEST_REGION_CAPACITY),
  overflowed: false,
  visiblePolygonComponents: new Float64Array(RETAINED_POLYGON_COMPONENT_CAPACITY),
  visiblePolygonComponentCount: 0,
  visiblePolygonCount: 0,
  visiblePolygonOffsets: new Uint32Array(RETAINED_POLYGON_CAPACITY + 1),
});

const resetVirtualTextureCoverageWorkspace = (
  workspace: VirtualTextureDemandPlanningWorkspace,
): void => {
  workspace.visiblePolygonCount = 0;
  workspace.visiblePolygonComponentCount = 0;
  workspace.finestRegionCount = 0;
  workspace.overflowed = false;
};

export const virtualTextureDemandPlanningWorkspaceSnapshot = (
  workspace: VirtualTextureDemandPlanningWorkspace,
): {
  readonly allocatedBytes: number;
  readonly finestObservedMip?: number;
  readonly finestRegionCount: number;
  readonly overflowed: boolean;
  readonly retainedBytes: number;
  readonly retainedPolygons: number;
} => ({
  allocatedBytes: workspace.clippedPolygonA.byteLength
    + workspace.clippedPolygonB.byteLength
    + workspace.wrappedPolygon.byteLength
    + workspace.finestRegionComponents.byteLength
    + workspace.finestRegionMips.byteLength
    + workspace.visiblePolygonComponents.byteLength
    + workspace.visiblePolygonOffsets.byteLength,
  overflowed: workspace.overflowed,
  ...(workspace.finestRegionCount > 0
    ? { finestObservedMip: workspace.finestRegionMips[0] }
    : {}),
  finestRegionCount: workspace.finestRegionCount,
  retainedBytes: workspace.visiblePolygonComponentCount * Float64Array.BYTES_PER_ELEMENT,
  retainedPolygons: workspace.visiblePolygonCount,
});

const finestRegionComponent = (
  workspace: VirtualTextureDemandPlanningWorkspace,
  regionIndex: number,
  component: number,
): number => workspace.finestRegionComponents[regionIndex * FINEST_REGION_COMPONENTS + component]!;

const copyFinestRegion = (
  workspace: VirtualTextureDemandPlanningWorkspace,
  from: number,
  to: number,
): void => {
  workspace.finestRegionMips[to] = workspace.finestRegionMips[from]!;
  const sourceOffset = from * FINEST_REGION_COMPONENTS;
  workspace.finestRegionComponents.copyWithin(
    to * FINEST_REGION_COMPONENTS,
    sourceOffset,
    sourceOffset + FINEST_REGION_COMPONENTS,
  );
};

const compareFinestRegionCandidate = (
  workspace: VirtualTextureDemandPlanningWorkspace,
  regionIndex: number,
  mip: number,
  minU: number,
  maxU: number,
  minV: number,
  maxV: number,
  screenWidth: number,
  screenHeight: number,
  screenArea: number,
): number => {
  const storedMip = workspace.finestRegionMips[regionIndex]!;
  if (mip !== storedMip) return mip - storedMip;
  const storedArea = finestRegionComponent(workspace, regionIndex, 6);
  if (screenArea !== storedArea) return storedArea - screenArea;
  const maximumExtent = Math.max(screenWidth, screenHeight);
  const storedMaximumExtent = Math.max(
    finestRegionComponent(workspace, regionIndex, 4),
    finestRegionComponent(workspace, regionIndex, 5),
  );
  if (maximumExtent !== storedMaximumExtent) return storedMaximumExtent - maximumExtent;
  const storedMinU = finestRegionComponent(workspace, regionIndex, 0);
  if (minU !== storedMinU) return minU - storedMinU;
  const storedMinV = finestRegionComponent(workspace, regionIndex, 2);
  if (minV !== storedMinV) return minV - storedMinV;
  const storedMaxU = finestRegionComponent(workspace, regionIndex, 1);
  if (maxU !== storedMaxU) return maxU - storedMaxU;
  const storedMaxV = finestRegionComponent(workspace, regionIndex, 3);
  if (maxV !== storedMaxV) return maxV - storedMaxV;
  return 0;
};

const retainFinestObservedRegion = (
  workspace: VirtualTextureDemandPlanningWorkspace,
  mip: number,
  minU: number,
  maxU: number,
  minV: number,
  maxV: number,
  observedScreenWidth: number,
  observedScreenHeight: number,
): void => {
  let duplicateIndex = -1;
  for (let index = 0; index < workspace.finestRegionCount; index += 1) {
    if (
      finestRegionComponent(workspace, index, 0) === minU
      && finestRegionComponent(workspace, index, 1) === maxU
      && finestRegionComponent(workspace, index, 2) === minV
      && finestRegionComponent(workspace, index, 3) === maxV
    ) {
      duplicateIndex = index;
      break;
    }
  }

  let screenWidth = observedScreenWidth;
  let screenHeight = observedScreenHeight;
  let screenArea = observedScreenWidth * observedScreenHeight;
  let retainedMip = mip;
  if (duplicateIndex >= 0) {
    retainedMip = Math.min(retainedMip, workspace.finestRegionMips[duplicateIndex]!);
    screenWidth = Math.max(screenWidth, finestRegionComponent(workspace, duplicateIndex, 4));
    screenHeight = Math.max(screenHeight, finestRegionComponent(workspace, duplicateIndex, 5));
    screenArea = Math.max(screenArea, finestRegionComponent(workspace, duplicateIndex, 6));
    for (let index = duplicateIndex; index + 1 < workspace.finestRegionCount; index += 1) {
      copyFinestRegion(workspace, index + 1, index);
    }
    workspace.finestRegionCount -= 1;
  }

  let insertionIndex = 0;
  while (
    insertionIndex < workspace.finestRegionCount
    && compareFinestRegionCandidate(
      workspace,
      insertionIndex,
      retainedMip,
      minU,
      maxU,
      minV,
      maxV,
      screenWidth,
      screenHeight,
      screenArea,
    ) >= 0
  ) insertionIndex += 1;
  if (insertionIndex >= FINEST_REGION_CAPACITY) return;
  const retainedCount = Math.min(workspace.finestRegionCount, FINEST_REGION_CAPACITY - 1);
  for (let index = retainedCount; index > insertionIndex; index -= 1) {
    copyFinestRegion(workspace, index - 1, index);
  }
  workspace.finestRegionMips[insertionIndex] = retainedMip;
  const componentOffset = insertionIndex * FINEST_REGION_COMPONENTS;
  workspace.finestRegionComponents[componentOffset] = minU;
  workspace.finestRegionComponents[componentOffset + 1] = maxU;
  workspace.finestRegionComponents[componentOffset + 2] = minV;
  workspace.finestRegionComponents[componentOffset + 3] = maxV;
  workspace.finestRegionComponents[componentOffset + 4] = screenWidth;
  workspace.finestRegionComponents[componentOffset + 5] = screenHeight;
  workspace.finestRegionComponents[componentOffset + 6] = screenArea;
  workspace.finestRegionCount = Math.min(workspace.finestRegionCount + 1, FINEST_REGION_CAPACITY);
};

const retainVisiblePolygon = (
  workspace: VirtualTextureDemandPlanningWorkspace,
  polygon: Float64Array,
  vertexCount: number,
): void => {
  const componentCount = vertexCount * CLIPPED_VERTEX_COMPONENTS;
  if (
    workspace.visiblePolygonCount >= RETAINED_POLYGON_CAPACITY
    || workspace.visiblePolygonComponentCount + componentCount > RETAINED_POLYGON_COMPONENT_CAPACITY
  ) {
    workspace.overflowed = true;
    return;
  }
  workspace.visiblePolygonOffsets[workspace.visiblePolygonCount] = workspace.visiblePolygonComponentCount;
  workspace.visiblePolygonComponents.set(
    polygon.subarray(0, componentCount),
    workspace.visiblePolygonComponentCount,
  );
  workspace.visiblePolygonComponentCount += componentCount;
  workspace.visiblePolygonCount += 1;
  workspace.visiblePolygonOffsets[workspace.visiblePolygonCount] = workspace.visiblePolygonComponentCount;
};

type WrappedInterval = {
  readonly maximum: number;
  readonly minimum: number;
  readonly safe: boolean;
};

const wrapVirtualTextureDemandCoordinate = (
  value: number,
  mode: TextureSamplerWrap,
): number => {
  switch (mode) {
    case "clamp-to-edge":
      return Math.max(0, Math.min(1, value));
    case "repeat":
      return value - Math.floor(value);
    case "mirrored-repeat": {
      const period = value - Math.floor(value / 2) * 2;
      return period <= 1 ? period : 2 - period;
    }
  }
};

const wrappedVirtualTextureDemandInterval = (
  minimum: number,
  maximum: number,
  mode: TextureSamplerWrap,
): WrappedInterval => {
  let safe = false;
  switch (mode) {
    case "clamp-to-edge":
      safe = maximum <= 0 || minimum >= 1 || (minimum >= 0 && maximum <= 1);
      break;
    case "repeat":
    case "mirrored-repeat":
      safe = Math.floor(minimum) === Math.floor(maximum);
      break;
  }
  if (!safe) return { maximum: 1, minimum: 0, safe: false };
  const first = wrapVirtualTextureDemandCoordinate(minimum, mode);
  const last = wrapVirtualTextureDemandCoordinate(maximum, mode);
  return {
    maximum: Math.max(first, last),
    minimum: Math.min(first, last),
    safe: true,
  };
};

const retainWrappedVisiblePolygon = (
  workspace: VirtualTextureDemandPlanningWorkspace,
  polygon: Float64Array,
  vertexCount: number,
  query: VirtualTextureCoverageQuery,
): { readonly maxU: number; readonly maxV: number; readonly minU: number; readonly minV: number } => {
  let rawMinU = Number.POSITIVE_INFINITY;
  let rawMaxU = Number.NEGATIVE_INFINITY;
  let orientedMinV = Number.POSITIVE_INFINITY;
  let orientedMaxV = Number.NEGATIVE_INFINITY;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * CLIPPED_VERTEX_COMPONENTS;
    const u = polygon[offset + 4]!;
    const v = polygon[offset + 5]!;
    rawMinU = Math.min(rawMinU, u);
    rawMaxU = Math.max(rawMaxU, u);
    orientedMinV = Math.min(orientedMinV, v);
    orientedMaxV = Math.max(orientedMaxV, v);
  }
  const wrapS = query.wrapS ?? "clamp-to-edge";
  const wrapT = query.wrapT ?? "clamp-to-edge";
  const wrappedU = wrappedVirtualTextureDemandInterval(rawMinU, rawMaxU, wrapS);
  const wrappedV = wrappedVirtualTextureDemandInterval(orientedMinV, orientedMaxV, wrapT);
  if (!wrappedU.safe || !wrappedV.safe) {
    workspace.overflowed = true;
    return {
      maxU: wrappedU.maximum,
      maxV: wrappedV.maximum,
      minU: wrappedU.minimum,
      minV: wrappedV.minimum,
    };
  }

  const componentCount = vertexCount * CLIPPED_VERTEX_COMPONENTS;
  workspace.wrappedPolygon.set(polygon.subarray(0, componentCount), 0);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * CLIPPED_VERTEX_COMPONENTS;
    workspace.wrappedPolygon[offset + 4] = wrapVirtualTextureDemandCoordinate(
      polygon[offset + 4]!,
      wrapS,
    );
    workspace.wrappedPolygon[offset + 5] = wrapVirtualTextureDemandCoordinate(
      polygon[offset + 5]!,
      wrapT,
    );
  }
  retainVisiblePolygon(workspace, workspace.wrappedPolygon, vertexCount);
  return {
    maxU: wrappedU.maximum,
    maxV: wrappedV.maximum,
    minU: wrappedU.minimum,
    minV: wrappedV.minimum,
  };
};

const clipPlaneDistance = (plane: number, polygon: Float64Array, offset: number): number => {
  const x = polygon[offset]!;
  const y = polygon[offset + 1]!;
  const z = polygon[offset + 2]!;
  const w = polygon[offset + 3]!;
  switch (plane) {
    case 0: return x + w;
    case 1: return w - x;
    case 2: return y + w;
    case 3: return w - y;
    case 4: return z + w;
    default: return w - z;
  }
};

const clipPolygonAgainstPlane = (
  input: Float64Array,
  inputCount: number,
  output: Float64Array,
  plane: number,
): number => {
  let outputCount = 0;
  let previousOffset = (inputCount - 1) * CLIPPED_VERTEX_COMPONENTS;
  let previousDistance = clipPlaneDistance(plane, input, previousOffset);
  let previousInside = previousDistance >= 0;
  for (let vertex = 0; vertex < inputCount; vertex += 1) {
    const currentOffset = vertex * CLIPPED_VERTEX_COMPONENTS;
    const currentDistance = clipPlaneDistance(plane, input, currentOffset);
    const currentInside = currentDistance >= 0;
    if (currentInside !== previousInside) {
      const denominator = previousDistance - currentDistance;
      if (!Number.isFinite(denominator) || denominator === 0 || outputCount >= CLIPPED_POLYGON_CAPACITY) return -1;
      const t = previousDistance / denominator;
      const outputOffset = outputCount * CLIPPED_VERTEX_COMPONENTS;
      for (let component = 0; component < CLIPPED_VERTEX_COMPONENTS; component += 1) {
        const previous = input[previousOffset + component]!;
        output[outputOffset + component] = previous + (input[currentOffset + component]! - previous) * t;
      }
      outputCount += 1;
    }
    if (currentInside) {
      if (outputCount >= CLIPPED_POLYGON_CAPACITY) return -1;
      const outputOffset = outputCount * CLIPPED_VERTEX_COMPONENTS;
      for (let component = 0; component < CLIPPED_VERTEX_COMPONENTS; component += 1) {
        output[outputOffset + component] = input[currentOffset + component]!;
      }
      outputCount += 1;
    }
    previousOffset = currentOffset;
    previousDistance = currentDistance;
    previousInside = currentInside;
  }
  return outputCount;
};

const clipPolygonAgainstUvBoundary = (
  input: Float64Array,
  inputCount: number,
  output: Float64Array,
  component: 4 | 5,
  boundary: number,
  keepGreater: boolean,
): number => {
  let outputCount = 0;
  let previousOffset = (inputCount - 1) * CLIPPED_VERTEX_COMPONENTS;
  let previousDistance = keepGreater
    ? input[previousOffset + component]! - boundary
    : boundary - input[previousOffset + component]!;
  let previousInside = previousDistance >= 0;
  for (let vertex = 0; vertex < inputCount; vertex += 1) {
    const currentOffset = vertex * CLIPPED_VERTEX_COMPONENTS;
    const currentDistance = keepGreater
      ? input[currentOffset + component]! - boundary
      : boundary - input[currentOffset + component]!;
    const currentInside = currentDistance >= 0;
    if (currentInside !== previousInside) {
      const denominator = previousDistance - currentDistance;
      if (!Number.isFinite(denominator) || denominator === 0 || outputCount >= CLIPPED_POLYGON_CAPACITY) return -1;
      const t = previousDistance / denominator;
      const outputOffset = outputCount * CLIPPED_VERTEX_COMPONENTS;
      for (let index = 0; index < CLIPPED_VERTEX_COMPONENTS; index += 1) {
        const previous = input[previousOffset + index]!;
        output[outputOffset + index] = previous + (input[currentOffset + index]! - previous) * t;
      }
      outputCount += 1;
    }
    if (currentInside) {
      if (outputCount >= CLIPPED_POLYGON_CAPACITY) return -1;
      const outputOffset = outputCount * CLIPPED_VERTEX_COMPONENTS;
      for (let index = 0; index < CLIPPED_VERTEX_COMPONENTS; index += 1) {
        output[outputOffset + index] = input[currentOffset + index]!;
      }
      outputCount += 1;
    }
    previousOffset = currentOffset;
    previousDistance = currentDistance;
    previousInside = currentInside;
  }
  return outputCount;
};

const projectExactVirtualTextureCoverage = (
  geometry: VirtualTextureCoverageGeometry,
  context: VirtualTextureCoverageQuery,
  workspace = createVirtualTextureDemandPlanningWorkspace(),
  manifest?: VirtualTextureManifestModel,
): VirtualTextureProjection => {
  const [viewportWidth, viewportHeight] = context.viewportSize;
  const modelCount = virtualTextureDemandModelCount(context.modelSource);
  const vertexCount = geometry.positions.length / 3;
  if (viewportWidth <= 0 || viewportHeight <= 0 || vertexCount === 0 || modelCount === 0) {
    return { kind: "indeterminate" };
  }

  let minNdcX = Number.POSITIVE_INFINITY;
  let maxNdcX = Number.NEGATIVE_INFINITY;
  let minNdcY = Number.POSITIVE_INFINITY;
  let maxNdcY = Number.NEGATIVE_INFINITY;
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  let clippedVertexCount = 0;
  let invalidGeometry = false;
  const { clippedPolygonA, clippedPolygonB } = workspace;
  const projectionView = multiplyMat4(context.projection, context.view);
  const triangleElementCount = geometry.indices?.length ?? vertexCount;
  if (triangleElementCount === 0) return { kind: "indeterminate" };

  for (let modelIndex = 0; modelIndex < modelCount; modelIndex += 1) {
    const source = context.modelSource;
    const model = source.kind === "single"
      ? source.model
      : multiplyMat4(source.rootModels[modelIndex]!, source.localModels[modelIndex]!);
    const mvp = multiplyMat4(projectionView, model);
    for (let element = 0; element < triangleElementCount; element += 3) {
      for (let corner = 0; corner < 3; corner += 1) {
        const vertexIndex = geometry.indices?.[element + corner] ?? element + corner;
        const positionOffset = vertexIndex * 3;
        const x = geometry.positions[positionOffset]!;
        const y = geometry.positions[positionOffset + 1]!;
        const z = geometry.positions[positionOffset + 2]!;
        const targetOffset = corner * CLIPPED_VERTEX_COMPONENTS;
        clippedPolygonA[targetOffset] = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
        clippedPolygonA[targetOffset + 1] = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
        clippedPolygonA[targetOffset + 2] = mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14];
        clippedPolygonA[targetOffset + 3] = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
        const texCoordOffset = vertexIndex * 2;
        const sourceU = geometry.texCoords[texCoordOffset]!;
        const sourceV = geometry.texCoords[texCoordOffset + 1]!;
        const coordinates = context.textureCoordinates;
        clippedPolygonA[targetOffset + 4] = coordinates === undefined
          ? sourceU
          : coordinates.row0[0] * sourceU + coordinates.row0[1] * sourceV + coordinates.row0[2];
        clippedPolygonA[targetOffset + 5] = coordinates === undefined
          ? sourceV
          : coordinates.row1[0] * sourceU + coordinates.row1[1] * sourceV + coordinates.row1[2];
        for (let component = 0; component < CLIPPED_VERTEX_COMPONENTS; component += 1) {
          if (!Number.isFinite(clippedPolygonA[targetOffset + component])) invalidGeometry = true;
        }
      }
      if (invalidGeometry) break;
      let input = clippedPolygonA;
      let output = clippedPolygonB;
      let polygonCount = 3;
      for (let plane = 0; plane < 6 && polygonCount > 0; plane += 1) {
        polygonCount = clipPolygonAgainstPlane(input, polygonCount, output, plane);
        const swap = input;
        input = output;
        output = swap;
      }
      if (polygonCount < 0) {
        invalidGeometry = true;
        break;
      }
      let polygonMinNdcX = Number.POSITIVE_INFINITY;
      let polygonMaxNdcX = Number.NEGATIVE_INFINITY;
      let polygonMinNdcY = Number.POSITIVE_INFINITY;
      let polygonMaxNdcY = Number.NEGATIVE_INFINITY;
      let twiceProjectedArea = 0;
      for (let vertex = 0; vertex < polygonCount; vertex += 1) {
        const offset = vertex * CLIPPED_VERTEX_COMPONENTS;
        const clipW = input[offset + 3]!;
        if (!(clipW > 0)) {
          invalidGeometry = true;
          break;
        }
        const ndcX = input[offset]! / clipW;
        const ndcY = input[offset + 1]! / clipW;
        const nextOffset = ((vertex + 1) % polygonCount) * CLIPPED_VERTEX_COMPONENTS;
        const nextW = input[nextOffset + 3]!;
        if (!(nextW > 0)) {
          invalidGeometry = true;
          break;
        }
        twiceProjectedArea += ndcX * (input[nextOffset + 1]! / nextW)
          - (input[nextOffset]! / nextW) * ndcY;
        polygonMinNdcX = Math.min(polygonMinNdcX, ndcX);
        polygonMaxNdcX = Math.max(polygonMaxNdcX, ndcX);
        polygonMinNdcY = Math.min(polygonMinNdcY, ndcY);
        polygonMaxNdcY = Math.max(polygonMaxNdcY, ndcY);
      }
      if (invalidGeometry) break;
      // A triangle with no projected fragment area cannot contribute texture
      // samples. Excluding it also prevents edge-on degenerates from inflating
      // the retained-polygon workspace.
      if (polygonCount > 0 && Math.abs(twiceProjectedArea) <= Number.EPSILON) continue;
      if (polygonCount === 0) continue;
      const wrapped = retainWrappedVisiblePolygon(workspace, input, polygonCount, context);
      minNdcX = Math.min(minNdcX, polygonMinNdcX);
      maxNdcX = Math.max(maxNdcX, polygonMaxNdcX);
      minNdcY = Math.min(minNdcY, polygonMinNdcY);
      maxNdcY = Math.max(maxNdcY, polygonMaxNdcY);
      minU = Math.min(minU, wrapped.minU);
      maxU = Math.max(maxU, wrapped.maxU);
      minV = Math.min(minV, wrapped.minV);
      maxV = Math.max(maxV, wrapped.maxV);
      clippedVertexCount += polygonCount;
      if (manifest !== undefined && polygonCount > 0) {
        const observedMinU = wrapped.minU;
        const observedMaxU = wrapped.maxU;
        const observedMinV = wrapped.minV;
        const observedMaxV = wrapped.maxV;
        const observedScreenHeight = Math.max(
          1,
          (polygonMaxNdcY - polygonMinNdcY) * 0.5 * viewportHeight,
        );
        const observedScreenWidth = Math.max(
          1,
          (polygonMaxNdcX - polygonMinNdcX) * 0.5 * viewportWidth,
        );
        retainFinestObservedRegion(
          workspace,
          virtualTextureTargetMipFromMetrics(
            manifest,
            observedMinU,
            observedMaxU,
            observedMinV,
            observedMaxV,
            observedScreenWidth,
            observedScreenHeight,
          ),
          observedMinU,
          observedMaxU,
          observedMinV,
          observedMaxV,
          observedScreenWidth,
          observedScreenHeight,
        );
      }
    }
    if (invalidGeometry) break;
  }

  if (invalidGeometry) return { kind: "indeterminate" };
  if (clippedVertexCount === 0) return { kind: "not-visible" };
  if (!Number.isFinite(minU) || !Number.isFinite(maxU) || !Number.isFinite(minV) || !Number.isFinite(maxV)) {
    return { kind: "indeterminate" };
  }

  const minScreenX = Math.max(0, (Math.max(-1, minNdcX) * 0.5 + 0.5) * viewportWidth);
  const maxScreenX = Math.min(viewportWidth, (Math.min(1, maxNdcX) * 0.5 + 0.5) * viewportWidth);
  const minScreenY = Math.max(0, (Math.max(-1, minNdcY) * 0.5 + 0.5) * viewportHeight);
  const maxScreenY = Math.min(viewportHeight, (Math.min(1, maxNdcY) * 0.5 + 0.5) * viewportHeight);
  return {
    footprint: {
      maxU,
      maxV,
      minU,
      minV,
      screenHeight: Math.max(1, maxScreenY - minScreenY),
      screenWidth: Math.max(1, maxScreenX - minScreenX),
    },
    kind: "visible",
  };
};

export const prepareVirtualTextureCoverageProvider = (
  geometry: VirtualTextureCoverageGeometry,
) => createVirtualTextureCoverageProvider(geometry, projectExactVirtualTextureCoverage);

export const projectVirtualTextureScreenFootprint = (
  context: VirtualTextureDrawDemandContext,
  workspace = createVirtualTextureDemandPlanningWorkspace(),
  manifest?: VirtualTextureManifestModel,
): VirtualTextureProjection => {
  resetVirtualTextureCoverageWorkspace(workspace);
  return queryVirtualTextureCoverage(
    context.provider,
    {
      modelSource: context.modelSource,
      projection: context.projection,
      ...(context.textureCoordinates === undefined ? {} : { textureCoordinates: context.textureCoordinates }),
      view: context.view,
      viewportSize: context.viewportSize,
      ...(context.wrapS === undefined ? {} : { wrapS: context.wrapS }),
      ...(context.wrapT === undefined ? {} : { wrapT: context.wrapT }),
    },
    workspace,
    manifest,
  );
};

const virtualTexturePageScreenError = (
  workspace: VirtualTextureDemandPlanningWorkspace,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
  viewportSize: ViewportSize,
): number => {
  const { clippedPolygonA, clippedPolygonB } = workspace;
  const [viewportWidth, viewportHeight] = viewportSize;
  const pageTexelSpan = virtualTexturePageTexelSpan(manifest, page.mip);
  const [minPageU, maxPageU] = virtualTexturePageUvRange(
    manifest.width,
    page.x,
    pageTexelSpan,
  );
  const [minPageV, maxPageV] = virtualTexturePageUvRange(
    manifest.height,
    page.y,
    pageTexelSpan,
  );
  let minNdcX = Number.POSITIVE_INFINITY;
  let maxNdcX = Number.NEGATIVE_INFINITY;
  let minNdcY = Number.POSITIVE_INFINITY;
  let maxNdcY = Number.NEGATIVE_INFINITY;
  for (let polygonIndex = 0; polygonIndex < workspace.visiblePolygonCount; polygonIndex += 1) {
      const componentOffset = workspace.visiblePolygonOffsets[polygonIndex]!;
      const componentCount = workspace.visiblePolygonOffsets[polygonIndex + 1]! - componentOffset;
      let polygonCount = componentCount / CLIPPED_VERTEX_COMPONENTS;
      clippedPolygonA.set(
        workspace.visiblePolygonComponents.subarray(componentOffset, componentOffset + componentCount),
        0,
      );
      let input = clippedPolygonA;
      let output = clippedPolygonB;
      const uvBoundaries = [minPageU, maxPageU, minPageV, maxPageV] as const;
      for (let boundaryIndex = 0; boundaryIndex < 4 && polygonCount > 0; boundaryIndex += 1) {
        polygonCount = clipPolygonAgainstUvBoundary(
          input,
          polygonCount,
          output,
          boundaryIndex < 2 ? 4 : 5,
          uvBoundaries[boundaryIndex]!,
          boundaryIndex % 2 === 0,
        );
        const swap = input;
        input = output;
        output = swap;
      }
      if (polygonCount < 0) return Number.POSITIVE_INFINITY;
      for (let vertex = 0; vertex < polygonCount; vertex += 1) {
        const offset = vertex * CLIPPED_VERTEX_COMPONENTS;
        const clipW = input[offset + 3]!;
        if (!(clipW > 0)) return Number.POSITIVE_INFINITY;
        minNdcX = Math.min(minNdcX, input[offset]! / clipW);
        maxNdcX = Math.max(maxNdcX, input[offset]! / clipW);
        minNdcY = Math.min(minNdcY, input[offset + 1]! / clipW);
        maxNdcY = Math.max(maxNdcY, input[offset + 1]! / clipW);
      }
  }
  if (!Number.isFinite(minNdcX) || !Number.isFinite(minNdcY)) return 0;
  const screenWidth = Math.max(0, maxNdcX - minNdcX) * 0.5 * viewportWidth;
  const screenHeight = Math.max(0, maxNdcY - minNdcY) * 0.5 * viewportHeight;
  return Math.max(screenWidth, screenHeight) / Math.max(1, manifest.pageSize);
};

export const virtualTextureDemandMipCount = (manifest: VirtualTextureManifestModel): number =>
  manifest.mipCount ?? derivedVirtualTextureMipCount(manifest.width, manifest.height, manifest.pageSize);

export const virtualTextureDemandPageGrid = (
  manifest: VirtualTextureManifestModel,
  mip: number,
): { readonly height: number; readonly width: number } => ({
  height: virtualTextureMipDimension(Math.ceil(manifest.height / manifest.pageSize), mip),
  width: virtualTextureMipDimension(Math.ceil(manifest.width / manifest.pageSize), mip),
});

const virtualTexturePageTexelSpan = (
  manifest: VirtualTextureManifestModel,
  mip: number,
): number => manifest.pageSize * (2 ** mip);

const virtualTexturePageUvRange = (
  dimension: number,
  pageIndex: number,
  pageTexelSpan: number,
): readonly [number, number] => [
  Math.min(1, pageIndex * pageTexelSpan / dimension),
  Math.min(1, (pageIndex + 1) * pageTexelSpan / dimension),
];

const virtualTextureTargetMipFromMetrics = (
  manifest: VirtualTextureManifestModel,
  minU: number,
  maxU: number,
  minV: number,
  maxV: number,
  screenWidth: number,
  screenHeight: number,
): number => {
  const uvWidth = Math.max(1 / Math.max(1, manifest.width), maxU - minU);
  const uvHeight = Math.max(1 / Math.max(1, manifest.height), maxV - minV);
  const texelsPerScreenX = (uvWidth * manifest.width) / Math.max(1, screenWidth);
  const texelsPerScreenY = (uvHeight * manifest.height) / Math.max(1, screenHeight);
  const texelsPerScreenPixel = Math.max(1, texelsPerScreenX, texelsPerScreenY);
  const refinementBias = Math.max(screenWidth, screenHeight) >= 512 ? 1 : 0;
  return Math.min(
    virtualTextureDemandMipCount(manifest) - 1,
    Math.max(0, Math.floor(Math.log2(texelsPerScreenPixel)) - refinementBias),
  );
};

export const virtualTextureTargetMip = (
  manifest: VirtualTextureManifestModel,
  footprint: VirtualTextureScreenFootprint,
): number => virtualTextureTargetMipFromMetrics(
  manifest,
  footprint.minU,
  footprint.maxU,
  footprint.minV,
  footprint.maxV,
  footprint.screenWidth,
  footprint.screenHeight,
);

export const virtualTexturePagesForFootprint = (
  manifest: VirtualTextureManifestModel,
  mip: number,
  footprint: VirtualTextureScreenFootprint,
): readonly VirtualTexturePageId[] => {
  const grid = virtualTextureDemandPageGrid(manifest, mip);
  const pageTexelSpan = virtualTexturePageTexelSpan(manifest, mip);
  const minX = Math.max(0, Math.min(
    grid.width - 1,
    Math.floor(footprint.minU * manifest.width / pageTexelSpan),
  ));
  const maxX = Math.max(minX, Math.min(
    grid.width - 1,
    Math.ceil(footprint.maxU * manifest.width / pageTexelSpan) - 1,
  ));
  const minY = Math.max(0, Math.min(
    grid.height - 1,
    Math.floor(footprint.minV * manifest.height / pageTexelSpan),
  ));
  const maxY = Math.max(minY, Math.min(
    grid.height - 1,
    Math.ceil(footprint.maxV * manifest.height / pageTexelSpan) - 1,
  ));
  const centerX = (footprint.minU + footprint.maxU) * 0.5 * manifest.width / pageTexelSpan;
  const centerY = (footprint.minV + footprint.maxV) * 0.5 * manifest.height / pageTexelSpan;
  const pages: VirtualTexturePageId[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) pages.push({ mip, x, y });
  }
  return pages.sort((left, right) =>
    virtualTextureDemandPageDistance(left, centerX, centerY)
    - virtualTextureDemandPageDistance(right, centerX, centerY)
    || left.y - right.y
    || left.x - right.x);
};

const boundedVirtualTexturePagesForFootprint = (
  source: VirtualTextureDemandSource,
  mip: number,
  footprint: VirtualTextureScreenFootprint,
  limit: number,
): readonly VirtualTexturePageId[] => {
  const boundedLimit = demandLimit(limit);
  if (boundedLimit === 0) return [];
  const grid = virtualTextureDemandPageGrid(source.manifest, mip);
  const span = virtualTexturePageTexelSpan(source.manifest, mip);
  const minX = Math.max(0, Math.min(grid.width - 1, Math.floor(footprint.minU * source.manifest.width / span)));
  const maxX = Math.max(minX, Math.min(grid.width - 1, Math.ceil(footprint.maxU * source.manifest.width / span) - 1));
  const minY = Math.max(0, Math.min(grid.height - 1, Math.floor(footprint.minV * source.manifest.height / span)));
  const maxY = Math.max(minY, Math.min(grid.height - 1, Math.ceil(footprint.maxV * source.manifest.height / span) - 1));
  if (source.manifest.pageAddressing === "sparse") {
    const footprintCenterX = (footprint.minU + footprint.maxU) * 0.5 * source.manifest.width / span;
    const footprintCenterY = (footprint.minV + footprint.maxV) * 0.5 * source.manifest.height / span;
    const pages: VirtualTexturePageId[] = [];
    const compare = (left: VirtualTexturePageId, right: VirtualTexturePageId): number =>
      virtualTextureDemandPageDistance(left, footprintCenterX, footprintCenterY)
      - virtualTextureDemandPageDistance(right, footprintCenterX, footprintCenterY)
      || left.y - right.y
      || left.x - right.x;
    // Sparse manifests are bounded by authored entries, never by their logical
    // address-space area. Retain only the nearest `limit` rows while scanning so
    // a large authored list also cannot create an unbounded temporary array.
    for (const page of source.manifest.pages) {
      if (page.mip !== mip || page.x < minX || page.x > maxX || page.y < minY || page.y > maxY) continue;
      let insertionIndex = pages.length;
      while (insertionIndex > 0 && compare(page, pages[insertionIndex - 1]!) < 0) insertionIndex -= 1;
      if (insertionIndex >= boundedLimit) continue;
      pages.splice(insertionIndex, 0, page);
      if (pages.length > boundedLimit) pages.pop();
    }
    return pages;
  }
  const centerX = Math.max(minX, Math.min(maxX, Math.floor((minX + maxX) * 0.5)));
  const centerY = Math.max(minY, Math.min(maxY, Math.floor((minY + maxY) * 0.5)));
  const maxRadius = Math.max(maxX - minX, maxY - minY);
  const pages: VirtualTexturePageId[] = [];
  for (let radius = 0; radius <= maxRadius && pages.length < boundedLimit; radius += 1) {
    const ringMinX = Math.max(minX, centerX - radius);
    const ringMaxX = Math.min(maxX, centerX + radius);
    const ringMinY = Math.max(minY, centerY - radius);
    const ringMaxY = Math.min(maxY, centerY + radius);
    for (let y = ringMinY; y <= ringMaxY && pages.length < boundedLimit; y += 1) {
      for (let x = ringMinX; x <= ringMaxX && pages.length < boundedLimit; x += 1) {
        if (Math.max(Math.abs(x - centerX), Math.abs(y - centerY)) !== radius) continue;
        const page = { mip, x, y };
        if (isVirtualTextureDemandPageAvailable(source, page)) pages.push(page);
      }
    }
  }
  return pages;
};

const planBoundedFinestRegionDemand = (
  source: VirtualTextureDemandSource,
  workspace: VirtualTextureDemandPlanningWorkspace,
  limit: number,
): readonly VirtualTexturePageId[] => {
  const boundedLimit = demandLimit(limit);
  if (boundedLimit === 0 || workspace.finestRegionCount === 0) return [];
  const regionCandidates: Array<readonly VirtualTexturePageId[]> = [];
  for (let regionIndex = 0; regionIndex < workspace.finestRegionCount; regionIndex += 1) {
    regionCandidates.push(boundedVirtualTexturePagesForFootprint(
      source,
      workspace.finestRegionMips[regionIndex]!,
      {
        maxU: finestRegionComponent(workspace, regionIndex, 1),
        maxV: finestRegionComponent(workspace, regionIndex, 3),
        minU: finestRegionComponent(workspace, regionIndex, 0),
        minV: finestRegionComponent(workspace, regionIndex, 2),
        screenHeight: finestRegionComponent(workspace, regionIndex, 5),
        screenWidth: finestRegionComponent(workspace, regionIndex, 4),
      },
      boundedLimit,
    ));
  }

  const pages: VirtualTexturePageId[] = [];
  const pageKeys = new Set<string>();
  let candidateIndex = 0;
  while (pages.length < boundedLimit) {
    let visitedCandidate = false;
    for (const candidates of regionCandidates) {
      const page = candidates[candidateIndex];
      if (page === undefined) continue;
      visitedCandidate = true;
      const key = virtualTexturePageKey(page);
      if (pageKeys.has(key)) continue;
      pageKeys.add(key);
      pages.push(page);
      if (pages.length >= boundedLimit) break;
    }
    if (!visitedCandidate) break;
    candidateIndex += 1;
  }
  return pages;
};

const virtualTextureFootprintPageCount = (
  manifest: VirtualTextureManifestModel,
  mip: number,
  footprint: VirtualTextureScreenFootprint,
): number => {
  const grid = virtualTextureDemandPageGrid(manifest, mip);
  const span = virtualTexturePageTexelSpan(manifest, mip);
  const minX = Math.max(0, Math.min(grid.width - 1, Math.floor(footprint.minU * manifest.width / span)));
  const maxX = Math.max(minX, Math.min(grid.width - 1, Math.ceil(footprint.maxU * manifest.width / span) - 1));
  const minY = Math.max(0, Math.min(grid.height - 1, Math.floor(footprint.minV * manifest.height / span)));
  const maxY = Math.max(minY, Math.min(grid.height - 1, Math.ceil(footprint.maxV * manifest.height / span) - 1));
  return (maxX - minX + 1) * (maxY - minY + 1);
};

const planBoundedExplicitOverflowDemand = (
  source: VirtualTextureDemandSource,
  targetMip: number,
  footprint: VirtualTextureScreenFootprint,
  limit: number,
): readonly VirtualTexturePageId[] => {
  const boundedLimit = demandLimit(limit);
  const pages: VirtualTexturePageId[] = [];
  for (let mip = virtualTextureDemandMipCount(source.manifest) - 1; mip >= targetMip; mip -= 1) {
    pages.push(...boundedVirtualTexturePagesForFootprint(
      source,
      mip,
      footprint,
      boundedLimit - pages.length,
    ));
    if (pages.length >= boundedLimit) break;
  }
  return pages;
};

export const isVirtualTextureDemandPageAvailable = (
  source: VirtualTextureDemandSource,
  page: VirtualTexturePageId,
): boolean => source.manifest.pageAddressing === "complete"
  || source.availablePageKeys?.has(virtualTexturePageKey(page)) === true;

/** Coarse-first bounded fallback; complete address spaces are produced only until limit. */
export const planVirtualTextureBootstrapDemand = (
  source: VirtualTextureDemandSource,
  limit = VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW,
): readonly VirtualTexturePageId[] => {
  const boundedLimit = demandLimit(limit);
  if (boundedLimit === 0) return [];
  const candidates = new Map<string, VirtualTexturePageId>();
  const add = (page: VirtualTexturePageId): boolean => {
    if (!isVirtualTextureDemandPageAvailable(source, page)) return false;
    candidates.set(virtualTexturePageKey(page), page);
    return candidates.size >= boundedLimit;
  };

  if (source.manifest.pageAddressing === "complete") {
    for (let mip = virtualTextureDemandMipCount(source.manifest) - 1; mip >= 0; mip -= 1) {
      const grid = virtualTextureDemandPageGrid(source.manifest, mip);
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) {
          if (add({ mip, x, y })) return [...candidates.values()];
        }
      }
    }
    return [...candidates.values()];
  }

  const explicit: VirtualTexturePageId[] = [];
  const compareExplicit = (left: VirtualTexturePageId, right: VirtualTexturePageId): number =>
    right.mip - left.mip || left.y - right.y || left.x - right.x;
  for (const page of source.manifest.pages) {
    let insertionIndex = explicit.length;
    while (insertionIndex > 0 && compareExplicit(page, explicit[insertionIndex - 1]!) < 0) insertionIndex -= 1;
    if (insertionIndex >= boundedLimit) continue;
    explicit.splice(insertionIndex, 0, page);
    if (explicit.length > boundedLimit) explicit.pop();
  }
  for (const page of explicit) add(page);
  return [...candidates.values()];
};

export const planVirtualTextureCoarseToFineDemand = (
  source: VirtualTextureDemandSource,
  targetMip: number,
  footprint: VirtualTextureScreenFootprint,
  targetMipPages?: readonly VirtualTexturePageId[],
  limit = VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW,
): readonly VirtualTexturePageId[] => {
  const boundedLimit = demandLimit(limit);
  const candidates: VirtualTexturePageId[] = [];
  for (let mip = virtualTextureDemandMipCount(source.manifest) - 1; mip >= targetMip; mip -= 1) {
    const pages = mip === targetMip && targetMipPages !== undefined
      ? targetMipPages
      : boundedVirtualTexturePagesForFootprint(
          source,
          mip,
          footprint,
          boundedLimit - candidates.length,
        );
    for (const page of pages) {
      if (!isVirtualTextureDemandPageAvailable(source, page)) continue;
      candidates.push(page);
      if (candidates.length >= boundedLimit) return candidates;
    }
  }
  return candidates;
};

type VirtualTextureRefinementCandidate = {
  readonly page: VirtualTexturePageId;
  readonly score: number;
  readonly spatialOrder: number;
};

// Refine before a resident texel reaches a full screen pixel, leaving enough
// admission headroom that subpixel camera jitter does not toggle the frontier.
const VIRTUAL_TEXTURE_REFINEMENT_ADMISSION_ERROR = 0.75;

const virtualTexturePageSpatialOrder = (page: VirtualTexturePageId): number => {
  let order = 0;
  let scale = 0.25;
  for (let bit = 0; bit < 20; bit += 1) {
    order += ((page.x >>> bit) & 1) * scale;
    scale *= 0.5;
    order += ((page.y >>> bit) & 1) * scale;
    scale *= 0.5;
  }
  return order;
};

/**
 * Builds a bounded coverage hierarchy. Coarse visible pages are emitted first;
 * refinements then follow descending projected screen error. Equal-error pages
 * use a deterministic low-discrepancy spatial order instead of center distance.
 */
const planVirtualTextureHierarchicalDemand = (
  source: VirtualTextureDemandSource,
  context: VirtualTextureDrawDemandContext,
  footprint: VirtualTextureScreenFootprint,
  workspace: VirtualTextureDemandPlanningWorkspace,
  limit = VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW,
): {
  readonly coverageCandidates: readonly VirtualTexturePageId[];
  readonly demandCandidates: readonly VirtualTexturePageId[];
} => {
  const boundedLimit = demandLimit(limit);
  if (boundedLimit === 0) return { coverageCandidates: [], demandCandidates: [] };
  const coarsestMip = virtualTextureDemandMipCount(source.manifest) - 1;
  const geometricRoots = [...boundedVirtualTexturePagesForFootprint(
    source,
    coarsestMip,
    footprint,
    boundedLimit,
  )]
    .sort((left, right) => virtualTexturePageSpatialOrder(left) - virtualTexturePageSpatialOrder(right)
      || left.y - right.y
      || left.x - right.x);
  const roots = geometricRoots.filter((page) => isVirtualTextureDemandPageAvailable(source, page));
  const demandCandidates = roots.slice(0, boundedLimit);
  const queuedKeys = new Set(demandCandidates.map(virtualTexturePageKey));
  const queue: VirtualTextureRefinementCandidate[] = [];
  const enqueueChildren = (parent: VirtualTexturePageId, parentScore: number): void => {
    if (parent.mip === 0 || parentScore <= VIRTUAL_TEXTURE_REFINEMENT_ADMISSION_ERROR) return;
    const childMip = parent.mip - 1;
    const childGrid = virtualTextureDemandPageGrid(source.manifest, childMip);
    for (let offsetY = 0; offsetY < 2; offsetY += 1) {
      for (let offsetX = 0; offsetX < 2; offsetX += 1) {
        const page = { mip: childMip, x: parent.x * 2 + offsetX, y: parent.y * 2 + offsetY };
        if (page.x >= childGrid.width || page.y >= childGrid.height) continue;
        const key = virtualTexturePageKey(page);
        if (queuedKeys.has(key)) continue;
        queuedKeys.add(key);
        const score = virtualTexturePageScreenError(workspace, source.manifest, page, context.viewportSize);
        if (score <= 0) continue;
        queue.push({ page, score, spatialOrder: virtualTexturePageSpatialOrder(page) });
      }
    }
  };
  for (const root of geometricRoots) {
    enqueueChildren(root, virtualTexturePageScreenError(
      workspace,
      source.manifest,
      root,
      context.viewportSize,
    ));
  }

  while (demandCandidates.length < boundedLimit && queue.length > 0) {
    let bestIndex = 0;
    for (let index = 1; index < queue.length; index += 1) {
      const candidate = queue[index]!;
      const best = queue[bestIndex]!;
      if (
        candidate.score > best.score
        || (candidate.score === best.score && candidate.page.mip > best.page.mip)
        || (candidate.score === best.score
          && candidate.page.mip === best.page.mip
          && candidate.spatialOrder < best.spatialOrder)
      ) {
        bestIndex = index;
      }
    }
    const candidate = queue[bestIndex]!;
    queue[bestIndex] = queue.at(-1)!;
    queue.pop();
    if (isVirtualTextureDemandPageAvailable(source, candidate.page)) demandCandidates.push(candidate.page);
    enqueueChildren(candidate.page, candidate.score);
  }
  return { coverageCandidates: roots, demandCandidates };
};

export const planVirtualTextureDrawDemand = (input: VirtualTextureDrawDemandInput): VirtualTextureDrawDemand => {
  const limit = demandLimit(input.limit);
  if (input.context === undefined) {
    return { demandCandidates: planVirtualTextureBootstrapDemand(input, limit) };
  }
  const workspace = input.workspace ?? createVirtualTextureDemandPlanningWorkspace();
  const projection = projectVirtualTextureScreenFootprint(input.context, workspace, input.manifest);
  if (projection.kind === "not-visible") return { coverageCandidates: [], demandCandidates: [] };
  if (projection.kind === "indeterminate") {
    const fallback = planVirtualTextureBootstrapDemand(input, limit);
    // Bootstrap is safe for explicit VT progress, but it does not prove exact
    // visible coverage. Auto-VT callers must retain their ordinary texture
    // fallback until projection produces a determinate footprint.
    return { coverageCandidates: [], demandCandidates: fallback };
  }
  if (workspace.overflowed) {
    const coarsestMip = virtualTextureDemandMipCount(input.manifest) - 1;
    let coverageMip = virtualTextureTargetMip(input.manifest, projection.footprint);
    const completeAddressSpace = input.manifest.pageAddressing === "complete";
    while (
      completeAddressSpace
      &&
      coverageMip < coarsestMip
      && virtualTextureFootprintPageCount(input.manifest, coverageMip, projection.footprint) > limit
    ) coverageMip += 1;
    const coverageCandidates = boundedVirtualTexturePagesForFootprint(
      input,
      coverageMip,
      projection.footprint,
      limit,
    );
    const preferredCandidates = planBoundedFinestRegionDemand(input, workspace, limit);
    return {
      coverageCandidates,
      demandCandidates: completeAddressSpace
        ? planVirtualTextureCoarseToFineDemand(
            input,
            coverageMip,
            projection.footprint,
            coverageCandidates,
            limit,
          )
        : planBoundedExplicitOverflowDemand(input, coverageMip, projection.footprint, limit),
      ...(preferredCandidates.length === 0 ? {} : { preferredCandidates }),
      retentionOverflowed: true,
    };
  }
  if (input.manifest.pageAddressing === "sparse") {
    // Sparse explicit manifests do not promise a complete ancestor hierarchy;
    // preserve their availability-aware coarse-to-fine traversal.
    const targetMip = virtualTextureTargetMip(input.manifest, projection.footprint);
    const coverageCandidates = boundedVirtualTexturePagesForFootprint(
      input,
      targetMip,
      projection.footprint,
      limit,
    );
    return {
      coverageCandidates,
      demandCandidates: planVirtualTextureCoarseToFineDemand(
        input,
        targetMip,
        projection.footprint,
        coverageCandidates,
        limit,
      ),
    };
  }
  const hierarchical = planVirtualTextureHierarchicalDemand(
    input,
    input.context,
    projection.footprint,
    workspace,
    limit,
  );
  return {
    ...hierarchical,
    preferredCandidates: hierarchical.demandCandidates,
  };
};

export const selectVirtualTextureWorkingSet = (
  candidates: readonly VirtualTexturePageId[],
  capacity: number,
  preferTargetMip = false,
): readonly VirtualTexturePageId[] => {
  const boundedCapacity = Number.isSafeInteger(capacity) ? Math.max(0, capacity) : 0;
  const targetMip = candidates.at(-1)?.mip;
  const targetCandidates = targetMip === undefined
    ? []
    : candidates.filter((page) => page.mip === targetMip);
  if (!preferTargetMip) return candidates.slice(0, Math.min(1, boundedCapacity));
  if (targetCandidates.length === candidates.length) return targetCandidates.slice(0, boundedCapacity);
  if (boundedCapacity <= 1) return candidates.slice(0, boundedCapacity);
  return candidates.length === 0
    ? []
    : [candidates[0]!, ...targetCandidates.slice(0, boundedCapacity - 1)];
};

export const stabilizeVirtualTextureDesiredPagesInto = (
  workingCandidates: readonly VirtualTexturePageId[],
  previousPages: readonly VirtualTexturePageId[],
  previousPageKeys: ReadonlySet<string>,
  occupiedSlots: number,
  isResident: (page: VirtualTexturePageId) => boolean,
  capacity: number,
  desiredPages: VirtualTexturePageId[],
  desiredPageKeys: Set<string>,
  canBecomeResident: (page: VirtualTexturePageId) => boolean = () => true,
): { readonly admissions: number; readonly deferred: boolean; readonly retentions: number } => {
  desiredPages.length = 0;
  desiredPageKeys.clear();
  const boundedCapacity = Number.isSafeInteger(capacity) ? Math.max(0, capacity) : 0;
  const freePhysicalSlots = Math.max(0, boundedCapacity - Math.max(0, occupiedSlots));
  let admissions = 0;
  let retentions = 0;
  const add = (page: VirtualTexturePageId): boolean => {
    if (desiredPages.length >= boundedCapacity) return false;
    const key = virtualTexturePageKey(page);
    if (desiredPageKeys.has(key)) return false;
    desiredPageKeys.add(key);
    desiredPages.push(page);
    if (!previousPageKeys.has(key)) admissions += 1;
    return true;
  };
  for (const page of workingCandidates) {
    const key = virtualTexturePageKey(page);
    if (isResident(page) || (previousPageKeys.has(key) && canBecomeResident(page))) add(page);
  }
  // Do not pipeline another destructive replacement while the preceding
  // admission still has no physical residency. Re-rendering the same demand
  // before its load settles must preserve the overlap that is currently
  // providing coverage, rather than consuming it one frame at a time.
  const awaitingPreviousAdmission = workingCandidates.some((page) => {
    const key = virtualTexturePageKey(page);
    return previousPageKeys.has(key) && !isResident(page) && canBecomeResident(page);
  });
  let freeAdmissions = 0;
  let replacementAdmissions = 0;
  for (const page of workingCandidates) {
    if (desiredPageKeys.has(virtualTexturePageKey(page))) continue;
    if (!isResident(page) && !canBecomeResident(page)) continue;
    if (
      freeAdmissions >= freePhysicalSlots
      && (awaitingPreviousAdmission || replacementAdmissions >= 2)
    ) break;
    if (!add(page)) continue;
    if (freeAdmissions < freePhysicalSlots) freeAdmissions += 1;
    else replacementAdmissions += 1;
  }
  const awaitingResidency = workingCandidates.some((page) => (
    desiredPageKeys.has(virtualTexturePageKey(page))
      && !isResident(page)
      && canBecomeResident(page)
  ));
  const deferred = awaitingResidency
    || workingCandidates.some((page) => (
      canBecomeResident(page) && !desiredPageKeys.has(virtualTexturePageKey(page))
    ));
  // Previous pages are overlap for a bounded destructive replacement, not a
  // standing cache policy. Once every required-now candidate is physically
  // resident, publish that exact set and let the GPU arena retain any spare
  // residency as inactive cache. This is what allows a far-away surface to
  // become one active coarse page without throwing away useful physical pages
  // prematurely.
  if (deferred) {
    for (const page of previousPages) {
      if (desiredPages.length >= boundedCapacity) break;
      if (!isResident(page)) continue;
      if (add(page)) retentions += 1;
    }
  }
  return {
    admissions,
    deferred,
    retentions,
  };
};

export interface VirtualTextureDemandSubmission {
  /** Unique candidates ordered from coarse fallback to finest target mip. */
  readonly candidates: readonly VirtualTexturePageId[];
  readonly preferTargetMip: boolean;
  readonly preferredCandidates?: readonly VirtualTexturePageId[];
}

const selectVirtualTextureSubmissionWorkingSet = (
  submission: VirtualTextureDemandSubmission,
  capacity: number,
): readonly VirtualTexturePageId[] => {
  if (submission.preferredCandidates === undefined) {
    return selectVirtualTextureWorkingSet(
      submission.candidates,
      capacity,
      submission.preferTargetMip,
    );
  }
  const boundedCapacity = Number.isSafeInteger(capacity) ? Math.max(0, capacity) : 0;
  if (!submission.preferTargetMip || boundedCapacity <= 1) {
    return submission.candidates.slice(0, boundedCapacity === 0 ? 0 : 1);
  }
  const selected = submission.candidates.length === 0 ? [] : [submission.candidates[0]!];
  const selectedKeys = new Set(selected.map(virtualTexturePageKey));
  for (const page of submission.preferredCandidates) {
    if (selected.length >= boundedCapacity) break;
    const key = virtualTexturePageKey(page);
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    selected.push(page);
  }
  return selected;
};

const commonCoarsePage = (
  queues: readonly (readonly VirtualTexturePageId[])[],
): VirtualTexturePageId | undefined => {
  if (queues.length < 2) return undefined;
  const remainingKeys = queues.slice(1).map((queue) => new Set(queue.map(virtualTexturePageKey)));
  let common: VirtualTexturePageId | undefined;
  for (const page of queues[0]!) {
    const key = virtualTexturePageKey(page);
    if (!remainingKeys.every((keys) => keys.has(key))) continue;
    if (common === undefined || page.mip > common.mip) common = page;
  }
  return common;
};

/**
 * Selects one frame's shared VT working set across ordered draw/view demands.
 * A common coarsest fallback is reserved first, then each submission receives
 * target-biased pages in stable round-robin order with global deduplication.
 */
export const selectVirtualTextureFrameWorkingSet = (
  submissions: readonly VirtualTextureDemandSubmission[],
  capacity: number,
  startSubmission = 0,
): readonly VirtualTexturePageId[] => {
  const boundedCapacity = Number.isSafeInteger(capacity) ? Math.max(0, capacity) : 0;
  if (boundedCapacity === 0 || submissions.length === 0) return [];
  if (submissions.length === 1) {
    const submission = submissions[0]!;
    return selectVirtualTextureSubmissionWorkingSet(submission, boundedCapacity);
  }

  const queues = submissions
    .map((submission, submissionIndex) => ({
      queue: selectVirtualTextureSubmissionWorkingSet(submission, boundedCapacity),
      submissionIndex,
    }))
    .filter((entry) => entry.queue.length > 0);
  if (queues.length === 0) return [];
  if (queues.length === 1) return queues[0]!.queue.slice(0, boundedCapacity);

  const selected: VirtualTexturePageId[] = [];
  const selectedKeys = new Set<string>();
  const add = (page: VirtualTexturePageId): boolean => {
    const key = virtualTexturePageKey(page);
    if (selectedKeys.has(key)) return false;
    selectedKeys.add(key);
    selected.push(page);
    return true;
  };
  const common = commonCoarsePage(queues.map((entry) => entry.queue));
  if (common !== undefined) add(common);
  if (selected.length >= boundedCapacity) return selected;

  const indices = queues.map(() => 0);
  const normalizedStart = Number.isSafeInteger(startSubmission)
    ? Math.max(0, startSubmission) % submissions.length
    : 0;
  const anchoredCursor = queues.findIndex((entry) => entry.submissionIndex >= normalizedStart);
  let cursor = anchoredCursor < 0 ? 0 : anchoredCursor;
  let scansWithoutAddition = 0;
  while (selected.length < boundedCapacity && scansWithoutAddition < queues.length) {
    const queueIndex = cursor;
    const queue = queues[queueIndex]!.queue;
    cursor = (cursor + 1) % queues.length;
    let added = false;
    while (indices[queueIndex]! < queue.length) {
      const page = queue[indices[queueIndex]!]!;
      indices[queueIndex] = indices[queueIndex]! + 1;
      if (add(page)) {
        added = true;
        break;
      }
    }
    scansWithoutAddition = added ? 0 : scansWithoutAddition + 1;
  }
  return selected;
};
