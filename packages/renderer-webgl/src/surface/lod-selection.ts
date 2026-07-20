import type { Mat4 } from "../math/mat4";
import type { WorldBounds } from "./surface-visibility";

export const CULLED_LOD_LEVEL = -1;

export type LodMembership = Readonly<{
  group: string;
  level: number;
  selectionBounds: WorldBounds;
  thresholds: readonly number[];
}>;

/** Shared visual/picking membership rule; an unselected cold group starts at level zero. */
export const lodMembershipsSelected = (
  lods: readonly Pick<LodMembership, "group" | "level">[] | undefined,
  selections: ReadonlyMap<string, number> | undefined,
): boolean => {
  if (lods === undefined) return true;
  for (const lod of lods) {
    if ((selections?.get(lod.group) ?? 0) !== lod.level) return false;
  }
  return true;
};

export type ProjectedBoundsWorkspace = Readonly<{
  clipCorners: Float64Array;
  screenExtents: Float64Array;
}>;

const CLIP_COMPONENTS = 4;
const CORNER_COUNT = 8;
const BOUNDS_EDGES = [
  0, 1, 2, 3, 4, 5, 6, 7,
  0, 2, 1, 3, 4, 6, 5, 7,
  0, 4, 1, 5, 2, 6, 3, 7,
] as const;

export const createProjectedBoundsWorkspace = (): ProjectedBoundsWorkspace => ({
  clipCorners: new Float64Array(CORNER_COUNT * CLIP_COMPONENTS),
  screenExtents: new Float64Array(4),
});

const fallbackThreshold = (level: number, levelCount: number): number =>
  level === levelCount - 1 ? 0 : 0.2 / (4 ** level);

/** Produces one complete, descending threshold contract from authored hints. */
export const normalizeLodThresholds = (
  hints: readonly unknown[] | undefined,
  levelCount: number,
): readonly number[] => {
  if (!Number.isSafeInteger(levelCount) || levelCount < 1) {
    throw new Error("Royal LOD level count must be a positive safe integer");
  }
  const thresholds = Array<number>(levelCount);
  let previous = 1;
  for (let level = 0; level < levelCount; level += 1) {
    const hint = hints?.[level];
    const threshold = typeof hint === "number" && Number.isFinite(hint)
      ? Math.max(0, Math.min(1, hint))
      : fallbackThreshold(level, levelCount);
    previous = Math.min(previous, threshold);
    thresholds[level] = previous;
  }
  return thresholds;
};

/** Pure retained-level transition with symmetric threshold hysteresis. */
export const hystereticLodLevel = (
  coverage: number,
  thresholds: readonly number[],
  previousLevel: number | undefined,
  hysteresisRatio = 0.15,
): number => {
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
    throw new Error("Royal LOD coverage must be finite and between zero and one");
  }
  if (!Number.isFinite(hysteresisRatio) || hysteresisRatio < 0 || hysteresisRatio > 1) {
    throw new Error("Royal LOD hysteresis ratio must be finite and between zero and one");
  }
  let target = CULLED_LOD_LEVEL;
  for (let level = 0; level < thresholds.length; level += 1) {
    if (coverage >= thresholds[level]!) {
      target = level;
      break;
    }
  }
  if (
    previousLevel === undefined
    || (previousLevel !== CULLED_LOD_LEVEL
      && (previousLevel < 0 || previousLevel >= thresholds.length))
  ) return target;
  let level = previousLevel === CULLED_LOD_LEVEL ? thresholds.length : previousLevel;
  while (level > 0) {
    if (coverage < Math.min(1, thresholds[level - 1]! * (1 + hysteresisRatio))) break;
    level -= 1;
  }
  while (level < thresholds.length) {
    if (coverage >= thresholds[level]! * (1 - hysteresisRatio)) break;
    level += 1;
  }
  return level === thresholds.length ? CULLED_LOD_LEVEL : level;
};

/** Resolves unavailable ideal levels without producing a visible hole. */
export const closestDrawableLodLevel = (
  target: number,
  previous: number | undefined,
  drawable: ArrayLike<number>,
  levelCount = drawable.length,
): number => {
  if (target === CULLED_LOD_LEVEL) return target;
  if (drawable[target] !== 0) return target;
  if (
    previous !== undefined
    && previous >= 0
    && previous < levelCount
    && drawable[previous] !== 0
  ) return previous;
  let closest = CULLED_LOD_LEVEL;
  let distance = Infinity;
  for (let level = 0; level < levelCount; level += 1) {
    if (drawable[level] === 0) continue;
    const candidateDistance = Math.abs(level - target);
    if (candidateDistance < distance) {
      closest = level;
      distance = candidateDistance;
    }
  }
  if (closest === CULLED_LOD_LEVEL) throw new Error("Royal LOD set has no drawable level");
  return closest;
};

const includeProjectedPoint = (
  extents: Float64Array,
  clipX: number,
  clipY: number,
  clipW: number,
): boolean => {
  if (!(clipW > 0) || !Number.isFinite(clipX) || !Number.isFinite(clipY)) return false;
  const x = Math.max(0, Math.min(1, (clipX / clipW + 1) * 0.5));
  const y = Math.max(0, Math.min(1, (clipY / clipW + 1) * 0.5));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  extents[0] = Math.min(extents[0]!, x);
  extents[1] = Math.min(extents[1]!, y);
  extents[2] = Math.max(extents[2]!, x);
  extents[3] = Math.max(extents[3]!, y);
  return true;
};

/** Computes clipped normalized screen area using caller-owned scratch. */
export const projectedBoundsScreenCoverage = (
  bounds: WorldBounds,
  viewProjection: Mat4,
  workspace: ProjectedBoundsWorkspace,
): number => {
  const corners = workspace.clipCorners;
  for (let corner = 0; corner < CORNER_COUNT; corner += 1) {
    const x = (corner & 1) === 0 ? bounds.min[0] : bounds.max[0];
    const y = (corner & 2) === 0 ? bounds.min[1] : bounds.max[1];
    const z = (corner & 4) === 0 ? bounds.min[2] : bounds.max[2];
    const offset = corner * CLIP_COMPONENTS;
    corners[offset] = viewProjection[0] * x + viewProjection[4] * y
      + viewProjection[8] * z + viewProjection[12];
    corners[offset + 1] = viewProjection[1] * x + viewProjection[5] * y
      + viewProjection[9] * z + viewProjection[13];
    corners[offset + 2] = viewProjection[2] * x + viewProjection[6] * y
      + viewProjection[10] * z + viewProjection[14];
    corners[offset + 3] = viewProjection[3] * x + viewProjection[7] * y
      + viewProjection[11] * z + viewProjection[15];
  }
  const extents = workspace.screenExtents;
  extents[0] = 1;
  extents[1] = 1;
  extents[2] = 0;
  extents[3] = 0;
  let projected = false;
  for (let corner = 0; corner < CORNER_COUNT; corner += 1) {
    const offset = corner * CLIP_COMPONENTS;
    const clipW = corners[offset + 3]!;
    if (corners[offset + 2]! + clipW < 0) continue;
    projected = includeProjectedPoint(extents, corners[offset]!, corners[offset + 1]!, clipW)
      || projected;
  }
  for (let edge = 0; edge < BOUNDS_EDGES.length; edge += 2) {
    const start = BOUNDS_EDGES[edge]! * CLIP_COMPONENTS;
    const end = BOUNDS_EDGES[edge + 1]! * CLIP_COMPONENTS;
    const startDistance = corners[start + 2]! + corners[start + 3]!;
    const endDistance = corners[end + 2]! + corners[end + 3]!;
    if ((startDistance >= 0) === (endDistance >= 0)) continue;
    const denominator = startDistance - endDistance;
    if (!Number.isFinite(denominator) || denominator === 0) continue;
    const t = startDistance / denominator;
    projected = includeProjectedPoint(
      extents,
      corners[start]! + (corners[end]! - corners[start]!) * t,
      corners[start + 1]! + (corners[end + 1]! - corners[start + 1]!) * t,
      corners[start + 3]! + (corners[end + 3]! - corners[start + 3]!) * t,
    ) || projected;
  }
  if (!projected) return 0;
  const coverage = Math.max(0, extents[2]! - extents[0]!)
    * Math.max(0, extents[3]! - extents[1]!);
  return Number.isFinite(coverage) ? Math.max(0, Math.min(1, coverage)) : 0;
};

/**
 * Resolves one conservative multi-view demand. A stereo frame therefore never
 * chooses a coarser level merely because the second eye was submitted last.
 */
export const maximumProjectedBoundsScreenCoverage = (
  bounds: WorldBounds,
  views: readonly Readonly<{ viewProjection: Mat4 }>[],
  workspace: ProjectedBoundsWorkspace,
): number => {
  let maximum = 0;
  for (const view of views) {
    maximum = Math.max(
      maximum,
      projectedBoundsScreenCoverage(bounds, view.viewProjection, workspace),
    );
    if (maximum === 1) break;
  }
  return maximum;
};

export type DrawableLodGroup = Readonly<{
  group: string;
  levels: readonly number[];
  selectionBounds: WorldBounds;
  surfaceIndices: readonly number[];
  thresholds: readonly number[];
}>;

export type DrawableLodResource = Readonly<{
  surface: Readonly<{
    lods?: readonly Pick<LodMembership, "group" | "level">[];
  }>;
}>;

export type DrawableLodSelectionWorkspace = {
  readonly activeGroups: Set<string>;
  drawableLevels: Uint8Array;
  readonly projection: ProjectedBoundsWorkspace;
  readonly selections: Map<string, number>;
};

export const createDrawableLodSelectionWorkspace = (): DrawableLodSelectionWorkspace => ({
  activeGroups: new Set(),
  drawableLevels: new Uint8Array(1),
  projection: createProjectedBoundsWorkspace(),
  selections: new Map(),
});

/**
 * Resolves view coverage, admitted-level fallback and compatible compound LOD
 * memberships into retained caller-owned state. The core has no GL authority
 * and allocates only when a newly observed group exceeds its workspace high-water mark.
 */
export const selectDrawableLodsInto = (
  groups: readonly DrawableLodGroup[],
  views: readonly Readonly<{ viewProjection: Mat4 }>[],
  resources: readonly (DrawableLodResource | undefined)[],
  workspace: DrawableLodSelectionWorkspace,
): ReadonlyMap<string, number> => {
  const { activeGroups, selections } = workspace;
  activeGroups.clear();
  if (groups.length === 0) {
    selections.clear();
    return selections;
  }
  for (const group of groups) {
    if (workspace.drawableLevels.length < group.thresholds.length) {
      workspace.drawableLevels = new Uint8Array(group.thresholds.length);
    } else workspace.drawableLevels.fill(0, 0, group.thresholds.length);
    let drawable = false;
    for (let index = 0; index < group.surfaceIndices.length; index += 1) {
      if (resources[group.surfaceIndices[index]!] === undefined) continue;
      workspace.drawableLevels[group.levels[index]!] = 1;
      drawable = true;
    }
    if (!drawable) continue;
    activeGroups.add(group.group);
    const coverage = maximumProjectedBoundsScreenCoverage(
      group.selectionBounds,
      views,
      workspace.projection,
    );
    const previous = selections.get(group.group);
    const target = hystereticLodLevel(coverage, group.thresholds, previous);
    selections.set(group.group, closestDrawableLodLevel(
      target,
      previous,
      workspace.drawableLevels,
      group.thresholds.length,
    ));
  }
  // Admission is prefix-bounded. Independent selectors may temporarily pick
  // a node/material combination whose complete packet is not uploaded yet;
  // retain one admitted combination for every affected set instead of a hole.
  for (const group of groups) {
    if (!activeGroups.has(group.group)) continue;
    let matched = false;
    let fallback: DrawableLodResource["surface"] | undefined;
    for (const surfaceIndex of group.surfaceIndices) {
      const surface = resources[surfaceIndex]?.surface;
      if (surface === undefined) continue;
      fallback ??= surface;
      if (lodMembershipsSelected(surface.lods, selections)) {
        matched = true;
        break;
      }
    }
    if (matched || fallback?.lods === undefined) continue;
    for (const lod of fallback.lods) selections.set(lod.group, lod.level);
  }
  for (const group of selections.keys()) {
    if (!activeGroups.has(group)) selections.delete(group);
  }
  return selections;
};
