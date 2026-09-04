import type { BoundedVolumeNode } from '@royal/renderer-core';
import { inverseMat4, transformMat4, type Mat4 } from '../math/mat4';
import { prepareCanonicalGeometry, type CanonicalTriangleGeometry } from './canonical-geometry';
import { transformedWorldBounds, type WorldBounds } from './surface-visibility';

export const MAX_BOUNDARY_PLANES = 32;
export const MAX_DENSITY_PROFILE_POINTS = 8;

export type CanonicalBoundedVolume = Readonly<{
  color: Float32Array;
  densityProfile: Float32Array;
  densityProfileCount: number;
  extinctionPerMetre: number;
  geometry: CanonicalTriangleGeometry;
  inverseModel: Mat4;
  model: Mat4;
  modelHandedness: 1 | -1;
  noiseScale: Float32Array;
  noiseStrength: number;
  node: BoundedVolumeNode;
  planeCount: number;
  planes: Float32Array;
  worldBounds: WorldBounds;
}>;

const coordinateKey = (positions: Float32Array, vertex: number): string => {
  const offset = vertex * 3;
  return `${positions[offset]!},${positions[offset + 1]!},${positions[offset + 2]!}`;
};

const canonicalModelHandedness = (model: Mat4): 1 | -1 => {
  const determinant = model[0] * (model[5] * model[10] - model[6] * model[9])
    - model[4] * (model[1] * model[10] - model[2] * model[9])
    + model[8] * (model[1] * model[6] - model[2] * model[5]);
  return determinant < 0 ? -1 : 1;
};

const boundaryPlanes = (geometry: CanonicalTriangleGeometry): Readonly<{
  count: number;
  values: Float32Array;
}> => {
  const { indices, positions } = geometry;
  const extent = Math.max(
    geometry.bounds.max[0] - geometry.bounds.min[0],
    geometry.bounds.max[1] - geometry.bounds.min[1],
    geometry.bounds.max[2] - geometry.bounds.min[2],
  );
  const tolerance = Math.max(1e-6, extent * 1e-5);
  const edges = new Map<string, { balance: number; count: number }>();
  const planes: number[] = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset]!;
    const b = indices[offset + 1]!;
    const c = indices[offset + 2]!;
    const aOffset = a * 3;
    const bOffset = b * 3;
    const cOffset = c * 3;
    const abX = positions[bOffset]! - positions[aOffset]!;
    const abY = positions[bOffset + 1]! - positions[aOffset + 1]!;
    const abZ = positions[bOffset + 2]! - positions[aOffset + 2]!;
    const acX = positions[cOffset]! - positions[aOffset]!;
    const acY = positions[cOffset + 1]! - positions[aOffset + 1]!;
    const acZ = positions[cOffset + 2]! - positions[aOffset + 2]!;
    let normalX = abY * acZ - abZ * acY;
    let normalY = abZ * acX - abX * acZ;
    let normalZ = abX * acY - abY * acX;
    const length = Math.hypot(normalX, normalY, normalZ);
    if (!(length > tolerance * tolerance)) {
      throw new Error(`bounded volume geometry triangle ${offset / 3} is degenerate`);
    }
    normalX /= length;
    normalY /= length;
    normalZ /= length;
    const distance = -(
      normalX * positions[aOffset]!
      + normalY * positions[aOffset + 1]!
      + normalZ * positions[aOffset + 2]!
    );
    let duplicate = false;
    for (let plane = 0; plane < planes.length; plane += 4) {
      if (
        normalX * planes[plane]! + normalY * planes[plane + 1]! + normalZ * planes[plane + 2]!
          > 1 - 1e-5
        && Math.abs(distance - planes[plane + 3]!) <= tolerance
      ) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      for (let vertexOffset = 0; vertexOffset < positions.length; vertexOffset += 3) {
        const signedDistance = normalX * positions[vertexOffset]!
          + normalY * positions[vertexOffset + 1]!
          + normalZ * positions[vertexOffset + 2]!
          + distance;
        if (signedDistance > tolerance) {
          throw new Error('bounded volume geometry must be convex with consistent outward winding');
        }
      }
      planes.push(normalX, normalY, normalZ, distance);
      if (planes.length / 4 > MAX_BOUNDARY_PLANES) {
        throw new Error(`bounded volume geometry supports at most ${MAX_BOUNDARY_PLANES} boundary planes`);
      }
    }

    for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
      const fromKey = coordinateKey(positions, from);
      const toKey = coordinateKey(positions, to);
      if (fromKey === toKey) {
        throw new Error('bounded volume geometry contains a zero-length edge');
      }
      const ascending = fromKey < toKey;
      const key = ascending ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`;
      const edge = edges.get(key) ?? { balance: 0, count: 0 };
      edge.count += 1;
      edge.balance += ascending ? 1 : -1;
      edges.set(key, edge);
    }
  }
  for (const edge of edges.values()) {
    if (edge.count !== 2 || edge.balance !== 0) {
      throw new Error('bounded volume geometry must be closed and consistently wound');
    }
  }
  const count = planes.length / 4;
  if (count < 4) throw new Error('bounded volume geometry must enclose a three-dimensional region');
  const values = new Float32Array(MAX_BOUNDARY_PLANES * 4);
  values.set(planes);
  return { count, values };
};

export const prepareCanonicalBoundedVolume = (
  node: BoundedVolumeNode,
): CanonicalBoundedVolume => {
  const geometry = prepareCanonicalGeometry(node.geometry);
  const model = transformMat4(node.transform);
  const inverseModel = inverseMat4(model);
  if (inverseModel === undefined) {
    throw new Error('bounded volume transform must be invertible');
  }
  const boundary = boundaryPlanes(geometry);
  const densityProfile = new Float32Array(MAX_DENSITY_PROFILE_POINTS * 2);
  for (let index = 0; index < node.densityProfile.length; index += 1) {
    densityProfile[index * 2] = node.densityProfile[index]![0];
    densityProfile[index * 2 + 1] = node.densityProfile[index]![1];
  }
  return {
    color: new Float32Array(node.color),
    densityProfile,
    densityProfileCount: node.densityProfile.length,
    extinctionPerMetre: node.extinctionPerMetre,
    geometry,
    inverseModel,
    model,
    modelHandedness: canonicalModelHandedness(model),
    noiseScale: new Float32Array(node.noiseScale),
    noiseStrength: node.noiseStrength,
    node,
    planeCount: boundary.count,
    planes: boundary.values,
    worldBounds: transformedWorldBounds(geometry.bounds, model),
  };
};
