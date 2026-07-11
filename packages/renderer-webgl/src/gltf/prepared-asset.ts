import type { Rgba, TextureContentKey, TextureSampler } from "@royal/renderer-core";
import type { GltfIndexArray } from "./accessors";
import type { Mat4 } from "../math/mat4";
import type { Bounds3 } from "../math/picking";
import type {
  SurfaceMaterialAlphaMode,
  SurfaceMaterialExtensionFactors,
} from "../webgl/materials";
import type { SurfaceImageBasedLight, SurfaceLight } from "../webgl/lights";
import type { GltfDocument } from "./schema";
import type { GltfTextureCoordinates } from "./texture-coordinates";

type GltfBasisuCodecModule = typeof import("./codecs/basisu");

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
  readonly color?: Rgba;
  readonly doubleSided: boolean;
  readonly emissive?: Rgba;
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
    readonly basisuCodec?: Promise<GltfBasisuCodecModule>;
    readonly buffers: readonly ArrayBuffer[];
    readonly document: GltfDocument;
    readonly src: string;
  };
  readonly lights: readonly SurfaceLight[];
  readonly load: GltfLoadMetrics;
  readonly nodeCount: number;
  readonly primitives: readonly LoadedGltfPrimitive[];
  readonly variants: readonly string[];
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

  detachImagePreparation(key: string, generation: number): void {
    const entry = this.#entries.get(key);
    if (
      this.#disposed
      || entry === undefined
      || entry.generation !== generation
      || entry.snapshot.status !== "ready"
      || entry.snapshot.asset.imagePreparation === undefined
    ) return;
    const { imagePreparation: _released, ...asset } = entry.snapshot.asset;
    entry.snapshot = Object.freeze({
      asset,
      generation,
      key,
      revision: entry.snapshot.revision + 1,
      status: "ready",
    });
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
      (error: unknown) => this.#publish(entry.request.key, generation, {
        error: `glTF load failed for ${entry.request.src}: ${error instanceof Error ? error.message : String(error)}`,
        status: "error",
      }),
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
      for (const listener of entry.listeners) {
        if (!listener.active || listener.revision >= entry.snapshot.revision) continue;
        listener.revision = entry.snapshot.revision;
        listenerNotified = true;
        listener.callback();
      }
      if (notifyChange || listenerNotified) this.#onChange();
    });
  }
}
