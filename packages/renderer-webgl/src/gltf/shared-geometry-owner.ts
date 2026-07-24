import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import type { PreparedStaticGltf } from "./static-asset";

export type SharedStaticGeometrySnapshot = Readonly<{
  pendingPreparationTasks: number;
  preparedTaskBytes: number;
  preparedTasks: number;
  preparationTaskClaims: number;
  primitiveClaims: number;
  retainedBytes: number;
  reusedClaims: number;
  reusedPreparationClaims: number;
  taskProducerPreparationDurationMs: number;
  uniqueGeometries: number;
}>;

const sameView = (
  left: ArrayBufferView<ArrayBufferLike> | undefined,
  right: ArrayBufferView<ArrayBufferLike> | undefined,
): boolean => {
  if (left === right) return true;
  if (
    left === undefined
    || right === undefined
    || left.constructor !== right.constructor
    || left.byteLength !== right.byteLength
  ) return false;
  const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
  const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
};

/** Exact canonical output equality; source keys only narrow candidates. */
export const sameCanonicalGeometry = (
  left: CanonicalTriangleGeometry,
  right: CanonicalTriangleGeometry,
): boolean =>
  left.bounds.min[0] === right.bounds.min[0]
  && left.bounds.min[1] === right.bounds.min[1]
  && left.bounds.min[2] === right.bounds.min[2]
  && left.bounds.max[0] === right.bounds.max[0]
  && left.bounds.max[1] === right.bounds.max[1]
  && left.bounds.max[2] === right.bounds.max[2]
  && sameView(left.indices, right.indices)
  && sameView(left.colors, right.colors)
  && sameView(left.normals, right.normals)
  && sameView(left.positions, right.positions)
  && sameView(left.tangents, right.tangents)
  && sameView(left.textureCoordinates0, right.textureCoordinates0)
  && sameView(left.textureCoordinates1, right.textureCoordinates1);

export const staticGeometryByteLength = (geometry: CanonicalTriangleGeometry): number =>
  geometry.indices.byteLength
  + geometry.positions.byteLength
  + (geometry.colors?.byteLength ?? 0)
  + (geometry.normals?.byteLength ?? 0)
  + (geometry.tangents?.byteLength ?? 0)
  + (geometry.textureCoordinates0?.byteLength ?? 0)
  + (geometry.textureCoordinates1?.byteLength ?? 0);

/**
 * Root-owned exact interning after worker transfer.
 *
 * This removes duplicate retained CPU arrays and gives the GPU owner one
 * canonical key. It is the exact-output fallback for roots which cannot enter
 * the pre-read shared-preparation protocol.
 */
export class SharedStaticGeometryOwner {
  readonly #candidates = new Map<string, CanonicalTriangleGeometry[]>();
  #snapshot: SharedStaticGeometrySnapshot = {
    pendingPreparationTasks: 0,
    preparedTaskBytes: 0,
    preparedTasks: 0,
    preparationTaskClaims: 0,
    primitiveClaims: 0,
    retainedBytes: 0,
    reusedClaims: 0,
    reusedPreparationClaims: 0,
    taskProducerPreparationDurationMs: 0,
    uniqueGeometries: 0,
  };

  clear(): void {
    this.#candidates.clear();
    this.#snapshot = {
      pendingPreparationTasks: 0,
      preparedTaskBytes: 0,
      preparedTasks: 0,
      preparationTaskClaims: 0,
      primitiveClaims: 0,
      retainedBytes: 0,
      reusedClaims: 0,
      reusedPreparationClaims: 0,
      taskProducerPreparationDurationMs: 0,
      uniqueGeometries: 0,
    };
  }

  intern(prepared: PreparedStaticGltf): PreparedStaticGltf {
    let changed = false;
    const primitives = prepared.primitives.map((primitive) => {
      const { geometry } = primitive;
      const sourceKey = geometry.sourceKey;
      if (sourceKey === undefined) return primitive;
      const candidates = this.#candidates.get(sourceKey);
      if (candidates === undefined) {
        this.#candidates.set(sourceKey, [geometry]);
        return primitive;
      }
      for (const candidate of candidates) {
        if (!sameCanonicalGeometry(candidate, geometry)) continue;
        if (candidate === geometry) return primitive;
        changed = true;
        return { ...primitive, geometry: candidate };
      }
      candidates.push(geometry);
      return primitive;
    });
    return changed ? { ...prepared, primitives } : prepared;
  }

  reconcile(preparedAssets: Iterable<PreparedStaticGltf>): void {
    this.#candidates.clear();
    const unique = new Set<CanonicalTriangleGeometry>();
    let primitiveClaims = 0;
    let reusedClaims = 0;
    let retainedBytes = 0;
    for (const prepared of preparedAssets) {
      for (const primitive of prepared.primitives) {
        primitiveClaims += 1;
        const geometry = primitive.geometry;
        if (unique.has(geometry)) {
          reusedClaims += 1;
          continue;
        }
        unique.add(geometry);
        retainedBytes += staticGeometryByteLength(geometry);
        const sourceKey = geometry.sourceKey;
        if (sourceKey === undefined) continue;
        const candidates = this.#candidates.get(sourceKey);
        if (candidates === undefined) this.#candidates.set(sourceKey, [geometry]);
        else candidates.push(geometry);
      }
    }
    this.#snapshot = {
      pendingPreparationTasks: this.#snapshot.pendingPreparationTasks,
      preparedTaskBytes: this.#snapshot.preparedTaskBytes,
      preparedTasks: this.#snapshot.preparedTasks,
      preparationTaskClaims: this.#snapshot.preparationTaskClaims,
      primitiveClaims,
      retainedBytes,
      reusedClaims,
      reusedPreparationClaims: this.#snapshot.reusedPreparationClaims,
      taskProducerPreparationDurationMs:
        this.#snapshot.taskProducerPreparationDurationMs,
      uniqueGeometries: unique.size,
    };
  }

  setPreparationSnapshot(
    snapshot: Pick<
      SharedStaticGeometrySnapshot,
      | "pendingPreparationTasks"
      | "preparedTaskBytes"
      | "preparedTasks"
      | "preparationTaskClaims"
      | "reusedPreparationClaims"
      | "taskProducerPreparationDurationMs"
    >,
  ): void {
    this.#snapshot = { ...this.#snapshot, ...snapshot };
  }

  snapshot(): SharedStaticGeometrySnapshot {
    return this.#snapshot;
  }
}
