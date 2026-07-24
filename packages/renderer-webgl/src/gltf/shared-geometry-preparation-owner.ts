import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import type { PreparedStaticGltf } from "./static-asset";
import { staticGltfBounds } from "./static-bounds";
import type { StaticGeometryTaskPlan } from "./static-geometry-plan";
import {
  staticGeometryByteLength,
  type SharedStaticGeometrySnapshot,
} from "./shared-geometry-owner";

type GeometryTaskEntry = {
  readonly claims: Set<string>;
  readonly promise: Promise<CanonicalTriangleGeometry>;
  readonly producer: string;
  preparedBytes: number;
  producerPreparationDurationMs: number;
  reject(error: unknown): void;
  resolve(geometry: CanonicalTriangleGeometry): void;
  state: "pending" | "ready";
};

export type SharedGeometryTaskClaim = Readonly<{
  computeKeys: ReadonlySet<string>;
  dependenciesReady: Promise<void>;
  hasDependencies: boolean;
  ready: Promise<ReadonlyMap<string, CanonicalTriangleGeometry>>;
}>;

const createTaskEntry = (producer: string): GeometryTaskEntry => {
  let reject = (_error: unknown): void => undefined;
  let resolve = (_geometry: CanonicalTriangleGeometry): void => undefined;
  const promise = new Promise<CanonicalTriangleGeometry>((accept, decline) => {
    reject = decline;
    resolve = accept;
  });
  return {
    claims: new Set(),
    producer,
    preparedBytes: 0,
    producerPreparationDurationMs: 0,
    promise,
    reject,
    resolve,
    state: "pending",
  };
};

/** Replaces worker placeholders with root-owned canonical geometry. */
export const resolveSharedStaticGeometry = (
  prepared: PreparedStaticGltf,
  geometries: ReadonlyMap<string, CanonicalTriangleGeometry>,
): PreparedStaticGltf => {
  let changed = false;
  const primitives = prepared.primitives.map((primitive) => {
    const key = primitive.deferredGeometryKey;
    if (key === undefined) return primitive;
    const geometry = geometries.get(key);
    if (geometry === undefined) {
      throw new Error("Royal shared geometry task did not produce a required primitive");
    }
    changed = true;
    const {
      deferredGeometryKey: _deferredGeometryKey,
      ...rest
    } = primitive;
    return { ...rest, geometry };
  });
  return changed
    ? { ...prepared, bounds: staticGltfBounds(primitives), primitives }
    : prepared;
};

/**
 * Joins exact source-derived geometry work before buffer reads and lowering.
 *
 * Failed producers reject current joiners; each surviving root can then fall
 * back through ordinary preparation without inheriting another root's error.
 */
export class SharedStaticGeometryPreparationOwner {
  readonly #entries = new Map<string, GeometryTaskEntry>();
  readonly #keysByOwner = new Map<string, readonly string[]>();

  claim(owner: string, plan: StaticGeometryTaskPlan): SharedGeometryTaskClaim {
    this.release(owner);
    const computeKeys = new Set<string>();
    const keys = [...new Set(plan.tasks.map(({ key }) => key))];
    const dependencies: Promise<CanonicalTriangleGeometry>[] = [];
    let hasDependencies = false;
    const pending = keys.map((key) => {
      let entry = this.#entries.get(key);
      if (entry === undefined) {
        entry = createTaskEntry(owner);
        this.#entries.set(key, entry);
        computeKeys.add(key);
      } else {
        dependencies.push(entry.promise);
        hasDependencies = true;
      }
      entry.claims.add(owner);
      return entry.promise.then((geometry) => [key, geometry] as const);
    });
    this.#keysByOwner.set(owner, keys);
    const dependenciesReady = Promise.all(dependencies).then(() => undefined);
    void dependenciesReady.catch(() => undefined);
    return {
      computeKeys,
      dependenciesReady,
      hasDependencies,
      ready: Promise.all(pending).then((values) => new Map(values)),
    };
  }

  resolve(
    prepared: PreparedStaticGltf,
    geometries: ReadonlyMap<string, CanonicalTriangleGeometry>,
  ): PreparedStaticGltf {
    return resolveSharedStaticGeometry(prepared, geometries);
  }

  fail(owner: string, error: unknown): void {
    for (const key of this.#keysByOwner.get(owner) ?? []) {
      const entry = this.#entries.get(key);
      if (entry?.producer !== owner || entry.state !== "pending") continue;
      this.#entries.delete(key);
      entry.reject(error);
    }
  }

  publish(
    owner: string,
    prepared: PreparedStaticGltf,
    computeKeys: ReadonlySet<string>,
    producerPreparationDurationMs = 0,
  ): void {
    const produced = new Map<string, CanonicalTriangleGeometry>();
    for (const primitive of prepared.primitives) {
      const key = primitive.geometry.sourceKey;
      if (
        key !== undefined
        && primitive.deferredGeometryKey === undefined
        && computeKeys.has(key)
      ) produced.set(key, primitive.geometry);
    }
    for (const key of computeKeys) {
      const entry = this.#entries.get(key);
      if (
        entry === undefined
        || entry.producer !== owner
        || entry.state !== "pending"
      ) continue;
      const geometry = produced.get(key);
      if (geometry === undefined) {
        const error = new Error("Royal shared geometry producer returned no canonical output");
        this.#entries.delete(key);
        entry.reject(error);
        throw error;
      }
      entry.state = "ready";
      entry.preparedBytes = staticGeometryByteLength(geometry);
      entry.producerPreparationDurationMs = computeKeys.size === 0
        ? 0
        : producerPreparationDurationMs / computeKeys.size;
      entry.resolve(geometry);
    }
  }

  release(owner: string): void {
    const keys = this.#keysByOwner.get(owner);
    if (keys === undefined) return;
    this.#keysByOwner.delete(owner);
    for (const key of keys) {
      const entry = this.#entries.get(key);
      if (entry === undefined) continue;
      entry.claims.delete(owner);
      if (entry.state === "pending" && entry.producer === owner) {
        this.#entries.delete(key);
        entry.reject(new DOMException(
          "Royal shared geometry producer was released",
          "AbortError",
        ));
        continue;
      }
      if (entry.claims.size !== 0) continue;
      this.#entries.delete(key);
      if (entry.state === "pending") {
        entry.reject(new DOMException(
          "Royal shared geometry preparation was abandoned",
          "AbortError",
        ));
      }
    }
  }

  clear(): void {
    for (const entry of this.#entries.values()) {
      if (entry.state === "pending") {
        entry.reject(new DOMException(
          "Royal shared geometry preparation was disposed",
          "AbortError",
        ));
      }
    }
    this.#entries.clear();
    this.#keysByOwner.clear();
  }

  snapshot(): Pick<
    SharedStaticGeometrySnapshot,
    | "pendingPreparationTasks"
    | "preparedTaskBytes"
    | "preparedTasks"
    | "preparationTaskClaims"
    | "reusedPreparationClaims"
    | "taskProducerPreparationDurationMs"
  > {
    let pendingPreparationTasks = 0;
    let preparedTaskBytes = 0;
    let preparationTaskClaims = 0;
    let taskProducerPreparationDurationMs = 0;
    for (const entry of this.#entries.values()) {
      preparationTaskClaims += entry.claims.size;
      if (entry.state === "pending") pendingPreparationTasks += 1;
      else {
        preparedTaskBytes += entry.preparedBytes;
        taskProducerPreparationDurationMs += entry.producerPreparationDurationMs;
      }
    }
    return {
      pendingPreparationTasks,
      preparedTaskBytes,
      preparedTasks: this.#entries.size - pendingPreparationTasks,
      preparationTaskClaims,
      reusedPreparationClaims: preparationTaskClaims - this.#entries.size,
      taskProducerPreparationDurationMs,
    };
  }
}
