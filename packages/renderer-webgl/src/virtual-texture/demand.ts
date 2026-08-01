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
  xs: Uint32Array;
  ys: Uint32Array;
}> & { count: number; overflow: boolean };

const CLIP_VERTEX_COMPONENTS = 6;
const MAX_CLIPPED_VERTICES = 12;
const MAX_DEMAND_SUBDIVISION_DEPTH = 4;

export const createVirtualTextureDemandWorkspace = (
  maxPages: number,
): VirtualTextureDemandWorkspace => {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new RangeError("Royal VT demand capacity must be a positive safe integer");
  }
  return {
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
    screen: new Float64Array(15),
    subdivision: new Float64Array(
      MAX_DEMAND_SUBDIVISION_DEPTH * 3 * CLIP_VERTEX_COMPONENTS,
    ),
    xs: new Uint32Array(maxPages),
    ys: new Uint32Array(maxPages),
  };
};

export const resetVirtualTextureDemand = (workspace: VirtualTextureDemandWorkspace): void => {
  workspace.count = 0;
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
  for (let ancestorMip = manifest.mipCount - 1; ancestorMip >= mip; ancestorMip -= 1) {
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
    for (let x = 0; x < layout.width; x += 1) addPage(workspace, mip, x, y);
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

/** Exact homogeneous trivial accept/reject before the polygon clipping slow path. */
const triangleClipKind = (vertices: Float64Array): -1 | 0 | 1 => {
  let commonOutsidePlanes = 0b11_1111;
  let anyOutsidePlanes = 0;
  for (let vertex = 0; vertex < 3; vertex += 1) {
    const offset = vertex * CLIP_VERTEX_COMPONENTS;
    let outsidePlanes = 0;
    for (let plane = 0; plane < 6; plane += 1) {
      if (planeDistance(vertices, offset, plane) < 0) outsidePlanes |= 1 << plane;
    }
    commonOutsidePlanes &= outsidePlanes;
    anyOutsidePlanes |= outsidePlanes;
  }
  return commonOutsidePlanes !== 0 ? -1 : anyOutsidePlanes === 0 ? 1 : 0;
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

const addClampedRange = (
  workspace: VirtualTextureDemandWorkspace,
  manifest: VirtualTextureManifest,
  mip: number,
  minU: number,
  maxU: number,
  minV: number,
  maxV: number,
): void => {
  const layout = manifest.mipLayouts[mip]!;
  const x0 = Math.min(layout.width - 1, Math.max(0, Math.floor(minU * layout.width)));
  const y0 = Math.min(layout.height - 1, Math.max(0, Math.floor(minV * layout.height)));
  const x1 = Math.min(
    layout.width - 1,
    Math.max(0, Math.floor(Math.max(0, maxU - Number.EPSILON) * layout.width)),
  );
  const y1 = Math.min(
    layout.height - 1,
    Math.max(0, Math.floor(Math.max(0, maxV - Number.EPSILON) * layout.height)),
  );
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) {
      addPageWithAncestors(workspace, manifest, mip, x, y);
    }
  }
};

const addWrappedRange = (
  workspace: VirtualTextureDemandWorkspace,
  manifest: VirtualTextureManifest,
  mip: number,
  minimumU: number,
  maximumU: number,
  minimumV: number,
  maximumV: number,
  sampler: CanonicalTextureSampler,
): void => {
  const repeatsU = sampler.wrapS !== "clamp-to-edge";
  const repeatsV = sampler.wrapT !== "clamp-to-edge";
  if (!repeatsU && !repeatsV) {
    addClampedRange(
      workspace,
      manifest,
      mip,
      Math.max(0, Math.min(1, minimumU)),
      Math.max(0, Math.min(1, maximumU)),
      Math.max(0, Math.min(1, minimumV)),
      Math.max(0, Math.min(1, maximumV)),
    );
    return;
  }
  const uSpan = maximumU - minimumU;
  const vSpan = maximumV - minimumV;
  const uStart = repeatsU ? Math.floor(minimumU) : 0;
  const uEnd = repeatsU ? Math.floor(maximumU) : 0;
  const vStart = repeatsV ? Math.floor(minimumV) : 0;
  const vEnd = repeatsV ? Math.floor(maximumV) : 0;
  if ((repeatsU && uSpan >= 1) || (repeatsV && vSpan >= 1)) {
    addClampedRange(
      workspace,
      manifest,
      mip,
      repeatsU && uSpan >= 1 ? 0 : minimumU - Math.floor(minimumU),
      repeatsU && uSpan >= 1 ? 1 : maximumU - Math.floor(minimumU),
      repeatsV && vSpan >= 1 ? 0 : minimumV - Math.floor(minimumV),
      repeatsV && vSpan >= 1 ? 1 : maximumV - Math.floor(minimumV),
    );
    return;
  }
  for (let tileY = vStart; tileY <= vEnd; tileY += 1) {
    for (let tileX = uStart; tileX <= uEnd; tileX += 1) {
      let localMinU = repeatsU ? Math.max(0, minimumU - tileX) : minimumU;
      let localMaxU = repeatsU ? Math.min(1, maximumU - tileX) : maximumU;
      let localMinV = repeatsV ? Math.max(0, minimumV - tileY) : minimumV;
      let localMaxV = repeatsV ? Math.min(1, maximumV - tileY) : maximumV;
      if (sampler.wrapS === "mirrored-repeat" && Math.abs(tileX) % 2 === 1) {
        const previousMinimum = localMinU;
        localMinU = 1 - localMaxU;
        localMaxU = 1 - previousMinimum;
      }
      if (sampler.wrapT === "mirrored-repeat" && Math.abs(tileY) % 2 === 1) {
        const previousMinimum = localMinV;
        localMinV = 1 - localMaxV;
        localMaxV = 1 - previousMinimum;
      }
      addClampedRange(
        workspace,
        manifest,
        mip,
        localMinU,
        localMaxU,
        localMinV,
        localMaxV,
      );
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
  for (let sample = 0; sample < 4; sample += 1) {
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
    const duDx = (uqDx * q - uq * qDx) * inverseQSquared;
    const dvDx = (vqDx * q - vq * qDx) * inverseQSquared;
    const duDy = (uqDy * q - uq * qDy) * inverseQSquared;
    const dvDy = (vqDy * q - vq * qDy) * inverseQSquared;
    const rho = Math.max(
      Math.hypot(duDx * manifest.width, dvDx * manifest.height),
      Math.hypot(duDy * manifest.width, dvDy * manifest.height),
    );
    const mip = Math.max(0, Math.min(
      manifest.mipCount - 1,
      Math.floor(Math.log2(Math.max(1, rho))),
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
  addWrappedRange(
    workspace,
    manifest,
    minimumMip,
    Math.min(
      screen[2]! / screen[4]!,
      screen[7]! / screen[9]!,
      screen[12]! / screen[14]!,
    ),
    Math.max(
      screen[2]! / screen[4]!,
      screen[7]! / screen[9]!,
      screen[12]! / screen[14]!,
    ),
    Math.min(
      screen[3]! / screen[4]!,
      screen[8]! / screen[9]!,
      screen[13]! / screen[14]!,
    ),
    Math.max(
      screen[3]! / screen[4]!,
      screen[8]! / screen[9]!,
      screen[13]! / screen[14]!,
    ),
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
  for (let index = 0; index + 2 < indices.length; index += 3) {
    let finite = true;
    for (let corner = 0; corner < 3; corner += 1) {
      writeClipVertex(
        workspace.clipA,
        corner * CLIP_VERTEX_COMPONENTS,
        indices[index + corner]! * 3,
        geometry,
        workspace.modelViewProjection,
        surface.textureCoordinates,
      );
      const offset = corner * CLIP_VERTEX_COMPONENTS;
      for (let component = 0; component < CLIP_VERTEX_COMPONENTS; component += 1) {
        if (!Number.isFinite(workspace.clipA[offset + component]!)) finite = false;
      }
    }
    if (!finite) {
      addCoarsestMip(workspace, manifest);
      continue;
    }
    const clipKind = triangleClipKind(workspace.clipA);
    if (clipKind < 0) continue;
    if (clipKind > 0) {
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
  for (let instance = 0; instance < instances.count; instance += 1) {
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
): void => {
  for (const view of views) {
    frustumPlanesInto(workspace.frustumPlanes, view.viewProjection);
    for (const surface of surfaces) {
      collectVirtualTextureSurfaceViewDemand(workspace, manifest, surface, view, sampler);
    }
  }
};
