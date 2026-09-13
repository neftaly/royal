import type { CanonicalTextureSampler } from "../texture/sampler";
import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import type { CanonicalTextureCoordinates } from "../surface/texture-coordinates";
import {
  identityMat4,
  multiplyMat4Into,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";
import type { FrameViewport } from "../frame/clear-frame";
import {
  frustumPlanesInto,
  emptyWorldBounds,
  includeTransformedBounds,
  worldBoundsVisible,
  type MutableWorldBounds,
  type WorldBounds,
} from "../surface/surface-visibility";
import {
  virtualTexturePageKeyParts,
  type VirtualTextureManifest,
} from "./manifest";

export type VirtualTextureDemandView = Readonly<{
  viewProjection: Mat4;
  viewport: FrameViewport;
}>;

export type VirtualTextureDemandSurface = Readonly<{
  geometry: CanonicalTriangleGeometry;
  instances?: Readonly<{ count: number; localModels: Float32Array }>;
  model: Mat4;
  textureCoordinates: CanonicalTextureCoordinates;
  worldBounds: WorldBounds;
}>;

export type VirtualTextureDemandWorkspace = Readonly<{
  ancestors: "all" | "coarsest";
  clipA: Float64Array;
  clipB: Float64Array;
  frustumPlanes: Float32Array;
  instanceBounds: MutableWorldBounds;
  keys: Set<number | string>;
  mips: Uint16Array;
  model: MutableMat4;
  modelViewProjection: MutableMat4;
  screen: Float64Array;
  subdivision: Float64Array;
  vertexCache: Float64Array;
  vertexKeys: Int32Array;
  vertexFlags: Uint8Array;
  xs: Uint32Array;
  ys: Uint32Array;
}> & { count: number; overflow: boolean; coarsestTarget: boolean; minimumMip: number; mipLinear: boolean };

const CLIP_VERTEX_COMPONENTS = 6;
const MAX_CLIPPED_VERTICES = 12;
const MAX_DEMAND_SUBDIVISION_DEPTH = 4;
const VERTEX_CACHE_SIZE = 256;
const FINEST_FOOTPRINT_SQUARED = 15;

export const virtualTextureDemandLod = (workspace: VirtualTextureDemandWorkspace): number => 0.5 * Math.log2(Math.max(1, workspace.screen[FINEST_FOOTPRINT_SQUARED]!));

export const createVirtualTextureDemandWorkspace = (
  maxPages: number,
  ancestors: "all" | "coarsest" = "all",
): VirtualTextureDemandWorkspace => {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new RangeError("Royal VT demand capacity must be a positive safe integer");
  }
  const screen = new Float64Array(FINEST_FOOTPRINT_SQUARED + 1);
  screen[FINEST_FOOTPRINT_SQUARED] = Infinity;
  return {
    ancestors,
    coarsestTarget: false,
    minimumMip: 0,
    mipLinear: false,
    clipA: new Float64Array(MAX_CLIPPED_VERTICES * CLIP_VERTEX_COMPONENTS),
    clipB: new Float64Array(MAX_CLIPPED_VERTICES * CLIP_VERTEX_COMPONENTS),
    count: 0,
    frustumPlanes: new Float32Array(24),
    instanceBounds: emptyWorldBounds(),
    keys: new Set(),
    mips: new Uint16Array(maxPages),
    model: identityMat4(),
    modelViewProjection: identityMat4(),
    overflow: false,
    screen,
    subdivision: new Float64Array(
      MAX_DEMAND_SUBDIVISION_DEPTH * 3 * CLIP_VERTEX_COMPONENTS,
    ),
    vertexCache: new Float64Array(VERTEX_CACHE_SIZE * CLIP_VERTEX_COMPONENTS),
    vertexKeys: new Int32Array(VERTEX_CACHE_SIZE),
    vertexFlags: new Uint8Array(VERTEX_CACHE_SIZE),
    xs: new Uint32Array(maxPages),
    ys: new Uint32Array(maxPages),
  };
};

export const resetVirtualTextureDemand = (workspace: VirtualTextureDemandWorkspace): void => {
  workspace.count = 0;
  workspace.coarsestTarget = false;
  workspace.screen[FINEST_FOOTPRINT_SQUARED] = Infinity;
  workspace.keys.clear();
  workspace.overflow = false;
};

/**
 * Fits demand by dropping complete fine levels. Spatially partial refinement is
 * more distracting than one uniformly coarser fallback and exposes page seams.
 */
export const truncateVirtualTextureDemand = (
  workspace: VirtualTextureDemandWorkspace,
  capacity: number,
): void => {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("Royal VT demand capacity must be a positive safe integer");
  }
  if (workspace.count <= capacity) return;
  if (workspace.ancestors === "coarsest") {
    // Direct targets omit intermediate levels. Synthesize a feasible parent
    // target instead of discarding all detail down to the coverage page.
    while (workspace.count > capacity) {
      let finest = Infinity;
      for (let index = 0; index < workspace.count; index += 1) finest = Math.min(finest, workspace.mips[index]!);
      let target = 0;
      workspace.keys.clear();
      for (let index = 0; index < workspace.count; index += 1) {
        const coarsen = workspace.mips[index] === finest;
        const mip = workspace.mips[index]! + (coarsen ? 1 : 0);
        const x = coarsen ? Math.floor(workspace.xs[index]! / 2) : workspace.xs[index]!;
        const y = coarsen ? Math.floor(workspace.ys[index]! / 2) : workspace.ys[index]!;
        const key = virtualTexturePageKeyParts(mip, x, y);
        if (workspace.keys.has(key)) continue;
        workspace.keys.add(key);
        workspace.mips[target] = mip;
        workspace.xs[target] = x;
        workspace.ys[target] = y;
        target += 1;
      }
      workspace.count = target;
    }
    workspace.overflow = true;
    return;
  }
  let minimumMip = 0;
  let maximumMip = 0;
  for (let index = 0; index < workspace.count; index += 1) {
    maximumMip = Math.max(maximumMip, workspace.mips[index]!);
  }
  let retainedCount = workspace.count;
  while (retainedCount > capacity && minimumMip < maximumMip) {
    minimumMip += 1;
    retainedCount = 0;
    for (let index = 0; index < workspace.count; index += 1) {
      if (workspace.mips[index]! >= minimumMip) retainedCount += 1;
    }
  }
  workspace.keys.clear();
  let target = 0;
  for (let source = 0; source < workspace.count; source += 1) {
    const mip = workspace.mips[source]!;
    if (mip < minimumMip || target >= capacity) continue;
    const x = workspace.xs[source]!;
    const y = workspace.ys[source]!;
    workspace.mips[target] = mip;
    workspace.xs[target] = x;
    workspace.ys[target] = y;
    workspace.keys.add(virtualTexturePageKeyParts(mip, x, y));
    target += 1;
  }
  workspace.count = target;
  workspace.overflow = true;
};

const addPage = (
  workspace: VirtualTextureDemandWorkspace,
  mip: number,
  x: number,
  y: number,
): void => {
  const key = virtualTexturePageKeyParts(mip, x, y);
  if (workspace.keys.has(key)) return;
  if (workspace.count >= workspace.mips.length) {
    workspace.overflow = true;
    return;
  }
  const index = workspace.count;
  workspace.keys.add(key);
  workspace.mips[index] = mip;
  workspace.xs[index] = x;
  workspace.ys[index] = y;
  workspace.count += 1;
};

/** Adds coarsest ancestors first so any capacity prefix remains drawable. */
const addPageWithAncestors = (
  workspace: VirtualTextureDemandWorkspace,
  manifest: VirtualTextureManifest,
  mip: number,
  x: number,
  y: number,
): void => {
  if (mip === manifest.mipCount - 1) workspace.coarsestTarget = true;
  // A retained target already has its required ancestors. Overlapping triangles
  // often request the same pages; avoid walking that chain again for each one.
  if (workspace.keys.has(virtualTexturePageKeyParts(mip, x, y))) return;
  for (let ancestorMip = manifest.mipCount - 1; ancestorMip >= mip; ancestorMip -= 1) {
    if (workspace.ancestors === "coarsest" && ancestorMip !== manifest.mipCount - 1
      && ancestorMip !== mip && !(workspace.mipLinear && ancestorMip === mip + 1)) continue;
    const divisor = 2 ** (ancestorMip - mip);
    addPage(workspace, ancestorMip, Math.floor(x / divisor), Math.floor(y / divisor));
  }
};

const addCoarsestMip = (
  workspace: VirtualTextureDemandWorkspace,
  manifest: VirtualTextureManifest,
): void => {
  const mip = manifest.mipCount - 1;
  const layout = manifest.mipLayouts[mip]!;
  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      addPage(workspace, mip, x, y);
      if (workspace.overflow) return;
    }
  }
};

const planeDistance = (vertices: Float64Array, offset: number, plane: number): number => {
  const x = vertices[offset]!;
  const y = vertices[offset + 1]!;
  const z = vertices[offset + 2]!;
  const w = vertices[offset + 3]!;
  switch (plane) {
    case 0: return x + w;
    case 1: return w - x;
    case 2: return y + w;
    case 3: return w - y;
    case 4: return z + w;
    default: return w - z;
  }
};

const copyVertex = (
  target: Float64Array,
  targetOffset: number,
  source: Float64Array,
  sourceOffset: number,
): void => {
  for (let component = 0; component < CLIP_VERTEX_COMPONENTS; component += 1) {
    target[targetOffset + component] = source[sourceOffset + component]!;
  }
};

const interpolateVertex = (
  target: Float64Array,
  targetOffset: number,
  start: Float64Array,
  startOffset: number,
  end: Float64Array,
  endOffset: number,
  amount: number,
): void => {
  for (let component = 0; component < CLIP_VERTEX_COMPONENTS; component += 1) {
    const from = start[startOffset + component]!;
    target[targetOffset + component] = from
      + (end[endOffset + component]! - from) * amount;
  }
};

const midpointVertex = (
  target: Float64Array,
  targetOffset: number,
  source: Float64Array,
  firstOffset: number,
  secondOffset: number,
): void => {
  for (let component = 0; component < CLIP_VERTEX_COMPONENTS; component += 1) {
    target[targetOffset + component] = (
      source[firstOffset + component]! + source[secondOffset + component]!
    ) * 0.5;
  }
};

const clipAgainstPlane = (
  source: Float64Array,
  sourceCount: number,
  target: Float64Array,
  plane: number,
): number => {
  let targetCount = 0;
  for (let index = 0; index < sourceCount; index += 1) {
    const currentOffset = index * CLIP_VERTEX_COMPONENTS;
    const previousOffset = ((index + sourceCount - 1) % sourceCount) * CLIP_VERTEX_COMPONENTS;
    const currentDistance = planeDistance(source, currentOffset, plane);
    const previousDistance = planeDistance(source, previousOffset, plane);
    const currentInside = currentDistance >= 0;
    const previousInside = previousDistance >= 0;
    if (currentInside !== previousInside) {
      const denominator = previousDistance - currentDistance;
      if (denominator !== 0 && targetCount < MAX_CLIPPED_VERTICES) {
        interpolateVertex(
          target,
          targetCount * CLIP_VERTEX_COMPONENTS,
          source,
          previousOffset,
          source,
          currentOffset,
          previousDistance / denominator,
        );
        targetCount += 1;
      }
    }
    if (currentInside && targetCount < MAX_CLIPPED_VERTICES) {
      copyVertex(target, targetCount * CLIP_VERTEX_COMPONENTS, source, currentOffset);
      targetCount += 1;
    }
  }
  return targetCount;
};

/** Cache finite validation and the six homogeneous outside-plane bits per vertex. */
const clipVertexFlags = (vertices: Float64Array, offset: number): number => {
  for (let component = 0; component < CLIP_VERTEX_COMPONENTS; component++) {
    if (!Number.isFinite(vertices[offset + component]!)) return 0b100_0000;
  }
  let flags = 0;
  for (let plane = 0; plane < 6; plane++) {
    if (planeDistance(vertices, offset, plane) < 0) flags |= 1 << plane;
  }
  return flags;
};

const writeClipVertex = (
  target: Float64Array,
  targetOffset: number,
  positionOffset: number,
  geometry: CanonicalTriangleGeometry,
  matrix: Mat4,
  coordinates: CanonicalTextureCoordinates,
): void => {
  const positions = geometry.positions;
  const x = positions[positionOffset]!;
  const y = positions[positionOffset + 1]!;
  const z = positions[positionOffset + 2]!;
  target[targetOffset] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  target[targetOffset + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  target[targetOffset + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  target[targetOffset + 3] = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const vertex = positionOffset / 3;
  const stream = coordinates.row0[3] === 1
    ? geometry.textureCoordinates1
    : geometry.textureCoordinates0;
  const u = stream?.[vertex * 2] ?? 0;
  const v = stream?.[vertex * 2 + 1] ?? 0;
  target[targetOffset + 4] = coordinates.row0[0] * u
    + coordinates.row0[1] * v + coordinates.row0[2];
  target[targetOffset + 5] = coordinates.row1[0] * u
    + coordinates.row1[1] * v + coordinates.row1[2];
};

const copyInstanceModel = (
  out: MutableMat4,
  outer: Mat4,
  instances: Float32Array,
  offset: number,
): void => {
  const a00 = outer[0]; const a01 = outer[1]; const a02 = outer[2]; const a03 = outer[3];
  const a10 = outer[4]; const a11 = outer[5]; const a12 = outer[6]; const a13 = outer[7];
  const a20 = outer[8]; const a21 = outer[9]; const a22 = outer[10]; const a23 = outer[11];
  const a30 = outer[12]; const a31 = outer[13]; const a32 = outer[14]; const a33 = outer[15];
  for (let column = 0; column < 4; column += 1) {
    const source = offset + column * 4;
    const target = column * 4;
    const b0 = instances[source]!;
    const b1 = instances[source + 1]!;
    const b2 = instances[source + 2]!;
    const b3 = instances[source + 3]!;
    out[target] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[target + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[target + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[target + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
};

const addWrappedRange = (
  workspace: VirtualTextureDemandWorkspace,
  manifest: VirtualTextureManifest,
  mip: number,
  sampler: CanonicalTextureSampler,
): void => {
  const screen = workspace.screen;
  const minimumU = Math.min(screen[2]! / screen[4]!, screen[7]! / screen[9]!, screen[12]! / screen[14]!);
  const maximumU = Math.max(screen[2]! / screen[4]!, screen[7]! / screen[9]!, screen[12]! / screen[14]!);
  const minimumV = Math.min(screen[3]! / screen[4]!, screen[8]! / screen[9]!, screen[13]! / screen[14]!);
  const maximumV = Math.max(screen[3]! / screen[4]!, screen[8]! / screen[9]!, screen[13]! / screen[14]!);
  const repeatsU = sampler.wrapS !== "clamp-to-edge";
  const repeatsV = sampler.wrapT !== "clamp-to-edge";
  // Saturate each repeating axis independently. The other axis still needs
  // its own clamp, seam splitting and mirrored-tile orientation.
  const fullU = repeatsU && maximumU - minimumU >= 1;
  const fullV = repeatsV && maximumV - minimumV >= 1;
  const uStart = repeatsU && !fullU ? Math.floor(minimumU) : 0;
  const uEnd = repeatsU && !fullU ? Math.floor(maximumU) : 0;
  const vStart = repeatsV && !fullV ? Math.floor(minimumV) : 0;
  const vEnd = repeatsV && !fullV ? Math.floor(maximumV) : 0;
  const layout = manifest.mipLayouts[mip]!;
  for (let dy = 0; dy <= vEnd - vStart; dy += 1) {
    const tileY = vStart + dy;
    for (let dx = 0; dx <= uEnd - uStart; dx += 1) {
      const tileX = uStart + dx;
      let localMinU = fullU ? 0 : repeatsU ? Math.max(0, minimumU - tileX) : minimumU;
      let localMaxU = fullU ? 1 : repeatsU ? Math.min(1, maximumU - tileX) : maximumU;
      let localMinV = fullV ? 0 : repeatsV ? Math.max(0, minimumV - tileY) : minimumV;
      let localMaxV = fullV ? 1 : repeatsV ? Math.min(1, maximumV - tileY) : maximumV;
      if (!fullU && sampler.wrapS === "mirrored-repeat" && Math.abs(tileX) % 2 === 1) {
        const previousMinimum = localMinU;
        localMinU = 1 - localMaxU;
        localMaxU = 1 - previousMinimum;
      }
      if (!fullV && sampler.wrapT === "mirrored-repeat" && Math.abs(tileY) % 2 === 1) {
        const previousMinimum = localMinV;
        localMinV = 1 - localMaxV;
        localMaxV = 1 - previousMinimum;
      }
      const x0 = Math.min(layout.width - 1, Math.max(0, Math.floor(localMinU * layout.width)));
      const y0 = Math.min(layout.height - 1, Math.max(0, Math.floor(localMinV * layout.height)));
      const x1 = Math.min(layout.width - 1, Math.max(0, Math.floor(Math.max(0, localMaxU - Number.EPSILON) * layout.width)));
      const y1 = Math.min(layout.height - 1, Math.max(0, Math.floor(Math.max(0, localMaxV - Number.EPSILON) * layout.height)));
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
          addPageWithAncestors(workspace, manifest, mip, x, y);
          if (workspace.overflow) return;
        }
      }
    }
  }
};

const addClippedTriangleDemand = (
  workspace: VirtualTextureDemandWorkspace,
  manifest: VirtualTextureManifest,
  vertices: Float64Array,
  first: number,
  second: number,
  third: number,
  viewport: FrameViewport,
  sampler: CanonicalTextureSampler,
  subdivisionDepth = 0,
): void => {
  const screen = workspace.screen;
  for (let index = 0; index < 3; index += 1) {
    const source = (index === 0 ? first : index === 1 ? second : third)
      * CLIP_VERTEX_COMPONENTS;
    const w = vertices[source + 3]!;
    if (!(w > 0)) return;
    const target = index * 5;
    const inverseW = 1 / w;
    screen[target] = (vertices[source]! / w * 0.5 + 0.5) * viewport.width;
    screen[target + 1] = (vertices[source + 1]! / w * 0.5 + 0.5) * viewport.height;
    screen[target + 2] = vertices[source + 4]! * inverseW;
    screen[target + 3] = vertices[source + 5]! * inverseW;
    screen[target + 4] = inverseW;
  }
  const dx1 = screen[5]! - screen[0]!;
  const dy1 = screen[6]! - screen[1]!;
  const dx2 = screen[10]! - screen[0]!;
  const dy2 = screen[11]! - screen[1]!;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return;
  const inverse = 1 / determinant;
  const uq1 = screen[7]! - screen[2]!;
  const uq2 = screen[12]! - screen[2]!;
  const vq1 = screen[8]! - screen[3]!;
  const vq2 = screen[13]! - screen[3]!;
  const q1 = screen[9]! - screen[4]!;
  const q2 = screen[14]! - screen[4]!;
  const uqDx = (uq1 * dy2 - uq2 * dy1) * inverse;
  const uqDy = (uq2 * dx1 - uq1 * dx2) * inverse;
  const vqDx = (vq1 * dy2 - vq2 * dy1) * inverse;
  const vqDy = (vq2 * dx1 - vq1 * dx2) * inverse;
  const qDx = (q1 * dy2 - q2 * dy1) * inverse;
  const qDy = (q2 * dx1 - q1 * dx2) * inverse;
  let minimumMip = manifest.mipCount - 1;
  let maximumMip = 0;
  let sampled = false;
  // Constant clip W makes perspective-correct derivatives constant over the
  // triangle. Flat cards and orthographic meshes need only one sample.
  const sampleCount = q1 === 0 && q2 === 0 ? 1 : 4;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const uq = sample === 3
      ? (screen[2]! + screen[7]! + screen[12]!) / 3
      : screen[sample * 5 + 2]!;
    const vq = sample === 3
      ? (screen[3]! + screen[8]! + screen[13]!) / 3
      : screen[sample * 5 + 3]!;
    const q = sample === 3
      ? (screen[4]! + screen[9]! + screen[14]!) / 3
      : screen[sample * 5 + 4]!;
    if (!(q > 0) || !Number.isFinite(q)) continue;
    const inverseQSquared = 1 / (q * q);
    const duDx = (uqDx * q - uq * qDx) * inverseQSquared * manifest.width;
    const dvDx = (vqDx * q - vq * qDx) * inverseQSquared * manifest.height;
    const duDy = (uqDy * q - uq * qDy) * inverseQSquared * manifest.width;
    const dvDy = (vqDy * q - vq * qDy) * inverseQSquared * manifest.height;
    // Match the shader's squared footprint without variadic hypot calls in the
    // triangle loop. Overflow selects the coarsest mip; values below one clamp.
    const footprintSquared = Math.max(duDx * duDx + dvDx * dvDx, duDy * duDy + dvDy * dvDy);
    // Preserve unclamped preview demand in existing typed scratch. Convert
    // its finest footprint to a fractional LOD once when the runtime asks.
    if (footprintSquared < screen[FINEST_FOOTPRINT_SQUARED]!) screen[FINEST_FOOTPRINT_SQUARED] = footprintSquared;
    const mip = Number.isNaN(footprintSquared) ? manifest.mipCount - 1 : Math.max(workspace.minimumMip, Math.min(
      manifest.mipCount - 1,
      Math.floor(0.5 * Math.log2(Math.max(1, footprintSquared))),
    ));
    minimumMip = Math.min(minimumMip, mip);
    maximumMip = Math.max(maximumMip, mip);
    sampled = true;
  }
  if (!sampled) return;
  if (
    minimumMip < maximumMip
    && subdivisionDepth < MAX_DEMAND_SUBDIVISION_DEPTH
  ) {
    const target = workspace.subdivision;
    const targetOffset = subdivisionDepth * 3 * CLIP_VERTEX_COMPONENTS;
    const firstOffset = first * CLIP_VERTEX_COMPONENTS;
    const secondOffset = second * CLIP_VERTEX_COMPONENTS;
    const thirdOffset = third * CLIP_VERTEX_COMPONENTS;
    const targetFirst = targetOffset / CLIP_VERTEX_COMPONENTS;
    for (let child = 0; child < 4; child += 1) {
      let childFirstStart = firstOffset; let childFirstEnd = firstOffset;
      let childSecondStart = firstOffset; let childSecondEnd = secondOffset;
      let childThirdStart = thirdOffset; let childThirdEnd = firstOffset;
      if (child === 1) {
        childFirstEnd = secondOffset;
        childSecondStart = secondOffset;
        childThirdStart = secondOffset;
        childThirdEnd = thirdOffset;
      } else if (child === 2) {
        childFirstStart = thirdOffset;
        childSecondStart = secondOffset;
        childSecondEnd = thirdOffset;
        childThirdEnd = thirdOffset;
      } else if (child === 3) {
        childFirstEnd = secondOffset;
        childSecondStart = secondOffset;
        childSecondEnd = thirdOffset;
      }
      midpointVertex(
        target,
        targetOffset,
        vertices,
        childFirstStart,
        childFirstEnd,
      );
      midpointVertex(
        target,
        targetOffset + CLIP_VERTEX_COMPONENTS,
        vertices,
        childSecondStart,
        childSecondEnd,
      );
      midpointVertex(
        target,
        targetOffset + CLIP_VERTEX_COMPONENTS * 2,
        vertices,
        childThirdStart,
        childThirdEnd,
      );
      addClippedTriangleDemand(
        workspace,
        manifest,
        target,
        targetFirst,
        targetFirst + 1,
        targetFirst + 2,
        viewport,
        sampler,
        subdivisionDepth + 1,
      );
    }
    return;
  }
  // Perspective can require several target mips within this final subdivision.
  // Keep those actual levels even when intermediate ancestors are omitted.
  for (let targetMip = minimumMip; targetMip <= maximumMip; targetMip += 1) addWrappedRange(
    workspace,
    manifest,
    targetMip,
    sampler,
  );
};

const collectModelDemand = (
  workspace: VirtualTextureDemandWorkspace,
  manifest: VirtualTextureManifest,
  surface: VirtualTextureDemandSurface,
  model: Mat4,
  view: VirtualTextureDemandView,
  sampler: CanonicalTextureSampler,
): void => {
  multiplyMat4Into(workspace.modelViewProjection, view.viewProjection, model);
  const { geometry } = surface;
  const indices = geometry.indices;
  // A small direct-mapped cache bounds scratch memory regardless of mesh size.
  // Clear per model/view so it cannot reuse transforms or UVs across instances.
  workspace.vertexKeys.fill(-1);
  for (let index = 0; index + 2 < indices.length && !workspace.overflow; index += 3) {
    let commonOutsidePlanes = 0b11_1111, anyFlags = 0;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices[index + corner]!;
      const slot = vertex & (VERTEX_CACHE_SIZE - 1);
      const cachedOffset = slot * CLIP_VERTEX_COMPONENTS;
      if (workspace.vertexKeys[slot] !== vertex) {
        writeClipVertex(workspace.vertexCache, cachedOffset, vertex * 3, geometry,
          workspace.modelViewProjection, surface.textureCoordinates);
        workspace.vertexKeys[slot] = vertex;
        workspace.vertexFlags[slot] = clipVertexFlags(workspace.vertexCache, cachedOffset);
      }
      copyVertex(workspace.clipA, corner * CLIP_VERTEX_COMPONENTS, workspace.vertexCache, cachedOffset);
      const flags = workspace.vertexFlags[slot]!;
      commonOutsidePlanes &= flags;
      anyFlags |= flags;
    }
    if (anyFlags & 0b100_0000) {
      addCoarsestMip(workspace, manifest);
      continue;
    }
    if (commonOutsidePlanes !== 0) continue;
    if (anyFlags === 0) {
      addClippedTriangleDemand(
        workspace,
        manifest,
        workspace.clipA,
        0,
        1,
        2,
        view.viewport,
        sampler,
      );
      continue;
    }
    let source = workspace.clipA;
    let target = workspace.clipB;
    let count = 3;
    for (let plane = 0; plane < 6 && count > 0; plane += 1) {
      count = clipAgainstPlane(source, count, target, plane);
      const previous = source;
      source = target;
      target = previous;
    }
    for (let triangle = 1; triangle + 1 < count; triangle += 1) {
      addClippedTriangleDemand(
        workspace,
        manifest,
        source,
        0,
        triangle,
        triangle + 1,
        view.viewport,
        sampler,
      );
    }
  }
};

const collectVirtualTextureSurfaceViewDemand = (
  workspace: VirtualTextureDemandWorkspace,
  manifest: VirtualTextureManifest,
  surface: VirtualTextureDemandSurface,
  view: VirtualTextureDemandView,
  sampler: CanonicalTextureSampler,
): void => {
  if (!worldBoundsVisible(surface.worldBounds, workspace.frustumPlanes)) return;
  const instances = surface.instances;
  if (instances === undefined || instances.count === 0) {
    collectModelDemand(workspace, manifest, surface, surface.model, view, sampler);
    return;
  }
  for (let instance = 0; instance < instances.count && !workspace.overflow; instance += 1) {
    copyInstanceModel(workspace.model, surface.model, instances.localModels, instance * 16);
    const bounds = workspace.instanceBounds;
    bounds.min[0] = Infinity;
    bounds.min[1] = Infinity;
    bounds.min[2] = Infinity;
    bounds.max[0] = -Infinity;
    bounds.max[1] = -Infinity;
    bounds.max[2] = -Infinity;
    includeTransformedBounds(bounds, surface.geometry.bounds, workspace.model);
    if (!worldBoundsVisible(bounds, workspace.frustumPlanes)) continue;
    collectModelDemand(workspace, manifest, surface, workspace.model, view, sampler);
  }
};

/** Collects bounded demand while sharing one broad-phase frustum across an asset's surfaces. */
export const collectVirtualTextureDemand = (
  workspace: VirtualTextureDemandWorkspace,
  manifest: VirtualTextureManifest,
  surfaces: readonly VirtualTextureDemandSurface[],
  views: readonly VirtualTextureDemandView[],
  sampler: CanonicalTextureSampler,
  minimumMip = 0,
): void => {
  const previousOverflow = workspace.overflow;
  workspace.overflow = false;
  workspace.minimumMip = minimumMip;
  workspace.mipLinear = sampler.minFilter.endsWith("mipmap-linear");
  for (const view of views) {
    frustumPlanesInto(workspace.frustumPlanes, view.viewProjection);
    for (const surface of surfaces) {
      collectVirtualTextureSurfaceViewDemand(workspace, manifest, surface, view, sampler);
      // The runtime restarts at a coarser minimum mip after overflow. Completing
      // this discarded pass would multiply dense/repeated-UV work needlessly.
      if (workspace.overflow) return;
    }
  }
  workspace.overflow = previousOverflow;
};
