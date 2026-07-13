import type { Mat4 } from "./mat4";
import type { Bounds3 } from "./picking";

const CLIP_COMPONENTS = 4;
const BOUNDS_CORNER_COUNT = 8;

// Corner indices differ by one bit along each box edge.
const BOUNDS_EDGES = [
  0, 1, 2, 3, 4, 5, 6, 7,
  0, 2, 1, 3, 4, 6, 5, 7,
  0, 4, 1, 5, 2, 6, 3, 7,
] as const;

export type ProjectedBoundsWorkspace = {
  readonly clipCorners: Float64Array;
  readonly screenExtents: Float64Array;
};

export const createProjectedBoundsWorkspace = (): ProjectedBoundsWorkspace => ({
  clipCorners: new Float64Array(BOUNDS_CORNER_COUNT * CLIP_COMPONENTS),
  screenExtents: new Float64Array(4),
});

const normalizedScreenCoordinate = (clip: number, clipW: number): number =>
  Math.max(0, Math.min(1, (clip / clipW + 1) * 0.5));

const includeProjectedPoint = (
  workspace: ProjectedBoundsWorkspace,
  clipX: number,
  clipY: number,
  clipW: number,
): boolean => {
  if (!(clipW > 0) || !Number.isFinite(clipX) || !Number.isFinite(clipY) || !Number.isFinite(clipW)) {
    return false;
  }
  const screenX = normalizedScreenCoordinate(clipX, clipW);
  const screenY = normalizedScreenCoordinate(clipY, clipW);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;
  const extents = workspace.screenExtents;
  extents[0] = Math.min(extents[0]!, screenX);
  extents[1] = Math.min(extents[1]!, screenY);
  extents[2] = Math.max(extents[2]!, screenX);
  extents[3] = Math.max(extents[3]!, screenY);
  return true;
};

/**
 * Returns the normalized screen-area of a bounds projection after clipping it
 * against the homogeneous near plane. Frustum culling remains a separate,
 * conservative decision; this function only supplies a stable LOD metric.
 */
export const projectedBoundsScreenCoverage = (
  bounds: Bounds3 | undefined,
  viewProjectionModel: Mat4,
  workspace: ProjectedBoundsWorkspace = createProjectedBoundsWorkspace(),
): number => {
  if (bounds === undefined) return 0;

  const corners = workspace.clipCorners;
  for (let corner = 0; corner < BOUNDS_CORNER_COUNT; corner += 1) {
    const x = (corner & 1) === 0 ? bounds.min[0] : bounds.max[0];
    const y = (corner & 2) === 0 ? bounds.min[1] : bounds.max[1];
    const z = (corner & 4) === 0 ? bounds.min[2] : bounds.max[2];
    const offset = corner * CLIP_COMPONENTS;
    corners[offset] = viewProjectionModel[0] * x + viewProjectionModel[4] * y
      + viewProjectionModel[8] * z + viewProjectionModel[12];
    corners[offset + 1] = viewProjectionModel[1] * x + viewProjectionModel[5] * y
      + viewProjectionModel[9] * z + viewProjectionModel[13];
    corners[offset + 2] = viewProjectionModel[2] * x + viewProjectionModel[6] * y
      + viewProjectionModel[10] * z + viewProjectionModel[14];
    corners[offset + 3] = viewProjectionModel[3] * x + viewProjectionModel[7] * y
      + viewProjectionModel[11] * z + viewProjectionModel[15];
  }

  const extents = workspace.screenExtents;
  extents[0] = 1;
  extents[1] = 1;
  extents[2] = 0;
  extents[3] = 0;
  let projected = false;

  for (let corner = 0; corner < BOUNDS_CORNER_COUNT; corner += 1) {
    const offset = corner * CLIP_COMPONENTS;
    const clipZ = corners[offset + 2]!;
    const clipW = corners[offset + 3]!;
    if (clipZ + clipW >= 0) {
      projected = includeProjectedPoint(workspace, corners[offset]!, corners[offset + 1]!, clipW)
        || projected;
    }
  }

  for (let edge = 0; edge < BOUNDS_EDGES.length; edge += 2) {
    const startOffset = BOUNDS_EDGES[edge]! * CLIP_COMPONENTS;
    const endOffset = BOUNDS_EDGES[edge + 1]! * CLIP_COMPONENTS;
    const startDistance = corners[startOffset + 2]! + corners[startOffset + 3]!;
    const endDistance = corners[endOffset + 2]! + corners[endOffset + 3]!;
    if ((startDistance >= 0) === (endDistance >= 0)) continue;
    const denominator = startDistance - endDistance;
    if (!Number.isFinite(denominator) || denominator === 0) continue;
    const t = startDistance / denominator;
    const clipX = corners[startOffset]!
      + (corners[endOffset]! - corners[startOffset]!) * t;
    const clipY = corners[startOffset + 1]!
      + (corners[endOffset + 1]! - corners[startOffset + 1]!) * t;
    const clipW = corners[startOffset + 3]!
      + (corners[endOffset + 3]! - corners[startOffset + 3]!) * t;
    projected = includeProjectedPoint(workspace, clipX, clipY, clipW) || projected;
  }

  if (!projected) return 0;
  const coverage = Math.max(0, extents[2]! - extents[0]!) * Math.max(0, extents[3]! - extents[1]!);
  return Number.isFinite(coverage) ? Math.max(0, Math.min(1, coverage)) : 0;
};
