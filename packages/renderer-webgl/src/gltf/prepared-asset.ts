import type { LinearRgba, TextureContentKey, TextureSampler } from "@royal/renderer-core";
import type { GltfIndexArray } from "./accessors";
import type { Mat4 } from "../math/mat4";
import type { Bounds3 } from "../math/picking";
import type {
  SurfaceMaterialAlphaMode,
  SurfaceMaterialExtensionFactors,
} from "../webgl/materials";
import type { SurfaceImageBasedLight, SurfaceLight } from "../webgl/lights";
import type { GltfTextureCoordinates } from "./texture-coordinates";
import { ResourceGovernorCpuCapacityError } from "../resource-governor";
import {
  gltfImageSourceRecipeBytes,
  type GltfImageSourceRecipe,
} from "./image-source-recipe";

export type GltfGeometryDrawMode =
  | "line-loop"
  | "line-strip"
  | "lines"
  | "points"
  | "triangle-fan"
  | "triangle-strip"
  | "triangles";

export type LoadedGltfMaterialTextureSlot = {
  readonly contentKey?: TextureContentKey;
  readonly coordinates: GltfTextureCoordinates;
  readonly imageUri?: string;
  readonly sampler?: TextureSampler;
  readonly sourceUri?: string;
  readonly textureUri?: string;
};

export type LoadedGltfMaterialExtensionTextures = {
  readonly clearcoatRoughnessTexture?: LoadedGltfMaterialTextureSlot;
  readonly clearcoatTexture?: LoadedGltfMaterialTextureSlot;
  readonly iridescenceTexture?: LoadedGltfMaterialTextureSlot;
  readonly iridescenceThicknessTexture?: LoadedGltfMaterialTextureSlot;
  readonly materialTransmissionTexture?: LoadedGltfMaterialTextureSlot;
  readonly sheenColorTexture?: LoadedGltfMaterialTextureSlot;
  readonly sheenRoughnessTexture?: LoadedGltfMaterialTextureSlot;
  readonly specularColorTexture?: LoadedGltfMaterialTextureSlot;
  readonly specularTexture?: LoadedGltfMaterialTextureSlot;
  readonly thicknessTexture?: LoadedGltfMaterialTextureSlot;
};

export type LoadedGltfMaterial = {
  readonly alphaCutoff?: number;
  readonly alphaMode: SurfaceMaterialAlphaMode;
  readonly baseColorTexture?: LoadedGltfMaterialTextureSlot;
  readonly color?: LinearRgba;
  readonly doubleSided: boolean;
  readonly emissive?: LinearRgba;
  readonly emissiveTexture?: LoadedGltfMaterialTextureSlot;
  readonly extensionFactors?: SurfaceMaterialExtensionFactors;
  readonly metallicRoughnessTexture?: LoadedGltfMaterialTextureSlot;
  readonly metallicFactor?: number;
  readonly normalTexture?: LoadedGltfMaterialTextureSlot;
  readonly normalScale?: number;
  readonly occlusionTexture?: LoadedGltfMaterialTextureSlot;
  readonly occlusionStrength?: number;
  readonly roughnessFactor?: number;
  readonly sourceMaterialIndex?: number;
  readonly unlit?: boolean;
  readonly extensionTextures?: LoadedGltfMaterialExtensionTextures;
};

export type GltfMaterialPrimitiveLod = {
  readonly levels: readonly LoadedGltfMaterial[];
  readonly thresholds: readonly number[];
};

export type LoadedGltfMaterialVariant = {
  readonly material: LoadedGltfMaterial;
  readonly materialLod?: GltfMaterialPrimitiveLod;
  readonly variants: readonly number[];
};

export type LoadedGltfPrimitiveMaterial = {
  readonly material: LoadedGltfMaterial;
  readonly materialLod?: GltfMaterialPrimitiveLod;
  readonly selectionKey: string;
};

export type GltfNodePrimitiveLod = {
  readonly group: string;
  readonly level: number;
  readonly levelCount: number;
  readonly thresholds: readonly number[];
};

export type LoadedGltfPrimitive = {
  readonly baseMaterial: LoadedGltfPrimitiveMaterial;
  readonly colors?: Float32Array;
  readonly indices?: GltfIndexArray;
  readonly instanceTransforms: readonly Mat4[];
  readonly key: string;
  readonly localBounds: readonly (Bounds3 | undefined)[];
  readonly localModelDeterminants: readonly number[];
  readonly localModels: readonly Mat4[];
  readonly material: LoadedGltfMaterial;
  readonly materialLod?: GltfMaterialPrimitiveLod;
  readonly materialVariants?: readonly LoadedGltfMaterialVariant[];
  readonly mode: GltfGeometryDrawMode;
  readonly meshNodeIndex: number;
  readonly nodePath: readonly number[];
  readonly nodeLod?: GltfNodePrimitiveLod;
  readonly normals?: Float32Array;
  readonly objectBounds: Bounds3 | undefined;
  readonly positions: Float32Array;
  readonly tangents?: Float32Array;
  readonly texCoords0?: Float32Array;
  readonly texCoords1?: Float32Array;
};

export type GltfLoadMetrics = {
  buffersLoadedAt?: number;
  documentLoadedAt?: number;
  dracoDecodedAt?: number;
  firstImageSettledAt?: number;
  imageFailures: number;
  imageLoaded: number;
  imageLoadStartedAt?: number;
  imageRequests: number;
  imagesSettledAt?: number;
  meshoptDecodedAt?: number;
  readyAt?: number;
  sceneReadAt?: number;
  readonly startedAt: number;
};

export type PreparedGltfAsset = {
  readonly hasMaterialLod: boolean;
  readonly hasMaterialVariants: boolean;
  readonly hasNodeLod: boolean;
  readonly imageBasedLight?: SurfaceImageBasedLight;
  /** CPU inputs retained so image decode never needs to refetch the document. */
  readonly imagePreparation?: {
    readonly recipes: readonly GltfImageSourceRecipe[];
  };
  readonly lights: readonly SurfaceLight[];
  readonly load: GltfLoadMetrics;
  readonly nodeCount: number;
  readonly primitives: readonly LoadedGltfPrimitive[];
  readonly variants: readonly string[];
};

export interface PreparedGltfAssetRetainedCpuBytes {
  /** Unique backing buffers reachable from retained primitive geometry. */
  readonly geometry: number;
  /** Other retained binary buffers needed for deferred image preparation. */
  readonly assetDecode: number;
}

const addRetainedBuffer = (
  buffers: Set<ArrayBufferLike>,
  value: ArrayBufferView | ArrayBufferLike | undefined,
): void => {
  if (value === undefined) return;
  buffers.add(ArrayBuffer.isView(value) ? value.buffer : value);
};

const retainedBufferBytes = (buffers: ReadonlySet<ArrayBufferLike>): number => {
  let bytes = 0;
  for (const buffer of buffers) {
    if (!Number.isSafeInteger(buffer.byteLength) || !Number.isSafeInteger(bytes + buffer.byteLength)) {
      throw new RangeError("Prepared glTF retained CPU bytes exceed safe integer capacity");
    }
    bytes += buffer.byteLength;
  }
  return bytes;
};

/** Counts unique retained binary backing stores without double-counting views. */
export const preparedGltfAssetRetainedCpuBytes = (
  asset: PreparedGltfAsset,
): PreparedGltfAssetRetainedCpuBytes => {
  const geometryBuffers = new Set<ArrayBufferLike>();
  for (const primitive of asset.primitives) {
    addRetainedBuffer(geometryBuffers, primitive.positions);
    addRetainedBuffer(geometryBuffers, primitive.normals);
    addRetainedBuffer(geometryBuffers, primitive.tangents);
    addRetainedBuffer(geometryBuffers, primitive.colors);
    addRetainedBuffer(geometryBuffers, primitive.texCoords0);
    addRetainedBuffer(geometryBuffers, primitive.texCoords1);
    addRetainedBuffer(geometryBuffers, primitive.indices);
    for (const matrix of primitive.localModels) {
      if (ArrayBuffer.isView(matrix)) addRetainedBuffer(geometryBuffers, matrix);
    }
    for (const matrix of primitive.instanceTransforms) {
      if (ArrayBuffer.isView(matrix)) addRetainedBuffer(geometryBuffers, matrix);
    }
  }
  return {
    assetDecode: gltfImageSourceRecipeBytes(asset.imagePreparation?.recipes ?? []),
    geometry: retainedBufferBytes(geometryBuffers),
  };
};

export type PreparedGltfAssetSnapshot =
  | {
    readonly generation: number;
    readonly key: string;
    readonly revision: number;
    readonly status: "loading";
  }
  | {
    readonly asset: PreparedGltfAsset;
    readonly generation: number;
    readonly key: string;
    readonly revision: number;
    readonly status: "ready";
  }
  | {
    readonly error: string;
    readonly generation: number;
    readonly key: string;
    readonly revision: number;
    readonly status: "error";
  };

export type PreparedGltfAssetRequest = {
  readonly key: string;
  readonly src: string;
};

export type PreparedGltfAssetSubscription = {
  readonly getSnapshot: () => PreparedGltfAssetSnapshot;
  readonly release: () => void;
};

type StoreEntry = {
  capacityBlocked: boolean;
  generation: number;
  listeners: Set<StoreListener>;
  notificationQueued: boolean;
  notifyChange: boolean;
  request: PreparedGltfAssetRequest;
  snapshot: PreparedGltfAssetSnapshot;
  subscribers: number;
};

type StoreListener = {
  active: boolean;
  readonly callback: () => void;
  revision: number;
};

export type PrepareGltfAssetJob = (
  request: PreparedGltfAssetRequest,
  signal: AbortSignal,
) => Promise<PreparedGltfAsset>;

/**
 * Owns prepared CPU glTF lifetimes. It deliberately knows nothing about WebGL:
 * jobs may fetch/decode, but their completion can only publish a new snapshot.
 */
export class PreparedGltfAssetStore {
  readonly #entries = new Map<string, StoreEntry>();
  readonly #load: PrepareGltfAssetJob;
  readonly #onChange: () => void;
  readonly #controllers = new Map<string, AbortController>();
  #disposed = false;
  #generation = 1;

  constructor(load: PrepareGltfAssetJob, onChange: () => void) {
    this.#load = load;
    this.#onChange = onChange;
  }

  request(request: PreparedGltfAssetRequest, listener?: () => void): PreparedGltfAssetSubscription {
    if (this.#disposed) throw new Error("PreparedGltfAssetStore is disposed");
    let entry = this.#entries.get(request.key);
    if (entry === undefined) {
      const generation = this.#generation++;
      entry = {
        capacityBlocked: false,
        generation,
        listeners: new Set(),
        notificationQueued: false,
        notifyChange: false,
        request,
        snapshot: Object.freeze({ generation, key: request.key, revision: 0, status: "loading" }),
        subscribers: 0,
      };
      this.#entries.set(request.key, entry);
      this.#start(entry);
    } else if (entry.request.src !== request.src) {
      throw new Error(`Prepared glTF key ${request.key} was requested for two sources`);
    }
    entry.subscribers += 1;
    const registration = listener === undefined
      ? undefined
      : {
        active: true,
        callback: listener,
        revision: entry.snapshot.status === "loading"
          ? entry.snapshot.revision
          : entry.snapshot.revision - 1,
      };
    if (registration !== undefined) entry.listeners.add(registration);
    let released = false;
    const subscription = {
      getSnapshot: () => entry!.snapshot,
      release: () => {
        if (released) return;
        released = true;
        if (registration !== undefined) {
          registration.active = false;
          entry!.listeners.delete(registration);
        }
        entry!.subscribers = Math.max(0, entry!.subscribers - 1);
        if (entry!.subscribers === 0 && this.#entries.get(request.key) === entry) {
          this.#controllers.get(request.key)?.abort();
          this.#controllers.delete(request.key);
          this.#entries.delete(request.key);
        }
      },
    };
    if (registration !== undefined && entry.snapshot.status !== "loading") this.#notify(entry, false);
    return subscription;
  }

  snapshot(key: string): PreparedGltfAssetSnapshot | undefined {
    return this.#entries.get(key)?.snapshot;
  }

  wakeCpuCapacity(): boolean {
    if (this.#disposed) return false;
    let woke = false;
    // Retry each entry that was blocked when the wake began exactly once.
    // The outer preparation scheduler remains the concurrency authority.
    for (const [key, entry] of Array.from(this.#entries)) {
      if (this.#disposed || this.#entries.get(key) !== entry) continue;
      if (!entry.capacityBlocked || entry.subscribers === 0) continue;
      entry.capacityBlocked = false;
      this.#entries.delete(key);
      this.#entries.set(key, entry);
      this.#start(entry);
      woke = true;
    }
    return woke;
  }

  detachImagePreparation(key: string, generation: number): boolean {
    const entry = this.#entries.get(key);
    if (
      this.#disposed
      || entry === undefined
      || entry.generation !== generation
      || entry.snapshot.status !== "ready"
      || entry.snapshot.asset.imagePreparation === undefined
    ) return false;
    const { imagePreparation: _released, ...asset } = entry.snapshot.asset;
    entry.snapshot = Object.freeze({
      asset,
      generation,
      key,
      revision: entry.snapshot.revision + 1,
      status: "ready",
    });
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
    this.#entries.clear();
  }

  #start(entry: StoreEntry): void {
    const controller = new AbortController();
    this.#controllers.set(entry.request.key, controller);
    const generation = entry.generation;
    void this.#load(entry.request, controller.signal).then(
      (asset) => this.#publish(entry.request.key, generation, { asset, status: "ready" }),
      (error: unknown) => {
        if (error instanceof ResourceGovernorCpuCapacityError && !error.permanent) {
          // Prepared byte size is known only after preparation. Do not retain
          // the rejected decoded asset outside the hard cap; a capacity wake
          // intentionally repeats preparation from the encoded source.
          const current = this.#entries.get(entry.request.key);
          if (current === entry && entry.generation === generation && entry.subscribers > 0) {
            this.#controllers.delete(entry.request.key);
            entry.capacityBlocked = true;
          }
          return;
        }
        this.#publish(entry.request.key, generation, {
          error: `glTF load failed for ${entry.request.src}: ${error instanceof Error ? error.message : String(error)}`,
          status: "error",
        });
      },
    );
  }

  #publish(
    key: string,
    generation: number,
    result: { readonly asset: PreparedGltfAsset; readonly status: "ready" }
      | { readonly error: string; readonly status: "error" },
  ): void {
    if (this.#disposed) return;
    const entry = this.#entries.get(key);
    if (entry === undefined || entry.generation !== generation) return;
    this.#controllers.delete(key);
    entry.snapshot = Object.freeze(result.status === "ready"
      ? {
        asset: result.asset,
        generation,
        key,
        revision: entry.snapshot.revision + 1,
        status: "ready",
      }
      : {
        error: result.error,
        generation,
        key,
        revision: entry.snapshot.revision + 1,
        status: "error",
      });
    this.#notify(entry, true);
  }

  #notify(entry: StoreEntry, change: boolean): void {
    entry.notifyChange ||= change;
    if (entry.notificationQueued) return;
    entry.notificationQueued = true;
    queueMicrotask(() => {
      if (this.#disposed || this.#entries.get(entry.request.key) !== entry) return;
      entry.notificationQueued = false;
      const notifyChange = entry.notifyChange;
      entry.notifyChange = false;
      let listenerNotified = false;
      for (const listener of Array.from(entry.listeners)) {
        if (
          !listener.active
          || !entry.listeners.has(listener)
          || listener.revision >= entry.snapshot.revision
        ) continue;
        listener.revision = entry.snapshot.revision;
        listenerNotified = true;
        try {
          listener.callback();
        } catch {
          // Subscriber failures cannot suppress peers or the store-level wake.
        }
      }
      if (notifyChange || listenerNotified) this.#onChange();
    });
  }
}
