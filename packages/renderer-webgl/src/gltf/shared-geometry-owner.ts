import {
  sameCanonicalGeometry,
  type CanonicalTriangleGeometry,
} from "../surface/canonical-geometry";
import type { PreparedStaticGltf } from "./static-asset";

export { sameCanonicalGeometry } from "../surface/canonical-geometry";

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
