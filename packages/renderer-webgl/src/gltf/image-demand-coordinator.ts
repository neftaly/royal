import type {
  TextureColorSpace,
  TextureContentKey,
  TextureSampler,
} from "@royal/renderer-core";
import { monotonicNowMs, type MonotonicClock } from "../clock";
import type { LoadedTextureSource } from "../texture/sources";
import { captureFirstFailure, type CapturedFailure } from "../captured-failure";
import type {
  SurfaceImageBasedLight,
  SurfaceImageBasedLightSpecular,
} from "../webgl/lights";
import type { SurfaceMaterialPublication } from "../webgl/materials";
import {
  GltfPreparationScheduler,
  type GltfPreparationJobAdmitter,
} from "./preparation-scheduler";
import type {
  GltfLoadMetrics,
  LoadedGltfMaterial,
  LoadedGltfMaterialTextureSlot,
} from "./prepared-asset";
import {
  GLTF_CORE_MATERIAL_TEXTURES,
  GLTF_MATERIAL_EXTENSION_TEXTURES,
} from "./material-texture-definitions";
import {
  decodePreparedGltfImageSourceRecipe,
  gltfImageSourceRecipeRequiresTransport,
  gltfImageSourceRecipeBytes,
  prepareGltfImageSourceRecipe,
  preparedGltfImageSourceRecipeWithoutTransport,
  type GltfImageSourceRecipe,
  type LoadedGltfImageSource,
  type PreparedGltfImageSourceRecipe,
} from "./image-source-recipe";

export type GltfImageTextureBinding = Readonly<{
  baseColor: boolean;
  colorSpace: TextureColorSpace;
  contentKey?: TextureContentKey;
  count: number;
  material: LoadedGltfMaterial;
  sampler?: TextureSampler;
  sourceUri?: string;
  textureUri: string;
}>;

export type GltfImageReadyOutcome = Readonly<{
  /** Acknowledges complete publication and releases coordinator source ownership. */
  acknowledge(): void;
  assetKey: string;
  bindings: readonly GltfImageTextureBinding[];
  contentKey?: TextureContentKey;
  iblSpecular?: SurfaceImageBasedLightSpecular;
  key: string;
  /** Checkpoints the semantic arena rekey before any fallible publication side effects. */
  markReferencesRekeyed(): void;
  materials: ReadonlySet<LoadedGltfMaterial>;
  /** Live checkpoint state; remains true on every retry handle for this outcome. */
  referencesRekeyed: boolean;
  source: LoadedTextureSource;
  stateInstanceKey: number;
}>;

export type GltfImageDemandCoordinatorSnapshot = Readonly<{
  active: number;
  candidates: number;
  dormant: number;
  errors: number;
  iblQueueHighWater: number;
  loading: number;
  ordinaryQueueHighWater: number;
  queueHighWater: number;
  queued: number;
  ready: number;
}>;

type RowStatus = "error" | "idle" | "loading" | "queued" | "ready";
type SourceLease = Readonly<{ release(): boolean }>;
type TransportLease = Readonly<{ release(): void }>;
type TransportLane = { head: number; readonly queue: Row[] };

type SourceCleanupDebt = {
  closePending: boolean;
  inProgress: boolean;
  lease: SourceLease | undefined;
  readonly source: LoadedTextureSource;
};

export interface GltfImageRecipeLease {
  /** Releases every recipe byte still owned by this asset. */
  release(): void;
  /** Atomically shrinks ownership to the exact unique retained backing bytes. */
  resize(retainedBytes: number): void;
}

type Row = {
  readonly asset: Asset;
  readonly bindings: GltfImageTextureBinding[];
  contentKey?: TextureContentKey;
  error?: string;
  iblSpecular?: SurfaceImageBasedLightSpecular;
  readonly key: string;
  readonly materials: Set<LoadedGltfMaterial>;
  outcomeQueued: boolean;
  pendingRefinements?: Set<LoadedGltfMaterial>;
  prepared?: PreparedGltfImageSourceRecipe;
  referencesRekeyed: boolean;
  recipe?: GltfImageSourceRecipe;
  source?: LoadedTextureSource;
  sourceLease?: SourceLease;
  status: RowStatus;
  transportError?: unknown;
  transportLease?: TransportLease;
  transportSettled: boolean;
};

type RecipeOwnership = {
  readonly activeRecipes: Set<GltfImageSourceRecipe>;
  readonly assetKey: string;
  readonly lease: GltfImageRecipeLease;
  operationInProgress: boolean;
  releaseRequested: boolean;
  released: boolean;
  readonly retainedRecipes: Set<GltfImageSourceRecipe>;
};

type Asset = {
  readonly controller: AbortController;
  readonly key: string;
  readonly load: GltfLoadMetrics;
  readonly pendingMaterialRows: WeakMap<LoadedGltfMaterial, number>;
  readonly publications: WeakMap<LoadedGltfMaterial, SurfaceMaterialPublication>;
  readonly recipeOwnership: RecipeOwnership;
  readonly readyKeys: Set<string>;
  readonly rows: Map<string, Row>;
  readonly settledMaterials: WeakSet<LoadedGltfMaterial>;
  readonly stateInstanceKey: number;
};

const EMPTY_IMAGE_KEYS: ReadonlySet<string> = new Set();

const GLTF_IBL_IMAGE_CONCURRENCY = 1;
const GLTF_ORDINARY_IMAGE_CONCURRENCY = 2;
const GLTF_IMAGE_TRANSPORT_CONCURRENCY = 4;

export const gltfImageDemandKeys = (
  materials: readonly LoadedGltfMaterial[],
  imageBasedLight: SurfaceImageBasedLight | undefined,
): ReadonlySet<string> => {
  const keys = new Set<string>();
  const add = (slot: LoadedGltfMaterialTextureSlot | undefined): void => {
    if (slot?.imageUri !== undefined) keys.add(slot.imageUri);
  };
  for (const material of materials) {
    for (const [key] of GLTF_CORE_MATERIAL_TEXTURES) add(material[key]);
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      add(material.extensionTextures?.[texture.key]);
    }
  }
  for (const mip of imageBasedLight?.specular?.imageLoadKeys ?? []) {
    for (const key of mip) keys.add(key);
  }
  return keys;
};

export class GltfImageDemandCoordinator {
  readonly #assets = new Map<string, Asset>();
  readonly #closeSource: (source: LoadedTextureSource) => void;
  readonly #diagnostic: (message: string, key: string) => void;
  readonly #iblScheduler: GltfPreparationScheduler;
  readonly #invalidate: () => void;
  readonly #now: MonotonicClock;
  readonly #ordinaryScheduler: GltfPreparationScheduler;
  readonly #ordinaryTransport: TransportLane = { head: 0, queue: [] };
  readonly #pendingOutcomes: Row[] = [];
  readonly #prepareRecipe: typeof prepareGltfImageSourceRecipe;
  readonly #progress: (assetKey: string) => void;
  readonly #recipeCleanupDebt = new Set<RecipeOwnership>();
  readonly #registrationClaims = new Map<string, object>();
  readonly #retainSource: (source: LoadedTextureSource) => SourceLease;
  readonly #reserveTransportBytes: ((bytes: number) => TransportLease) | undefined;
  readonly #requiresTransport: (recipe: GltfImageSourceRecipe) => boolean;
  readonly #sourceCleanupDebt = new Set<SourceCleanupDebt>();
  readonly #transportScheduler = new GltfPreparationScheduler(GLTF_IMAGE_TRANSPORT_CONCURRENCY);
  readonly #decodeRecipe: typeof decodePreparedGltfImageSourceRecipe;
  readonly #iblTransport: TransportLane = { head: 0, queue: [] };
  #cleanupRetryScheduled = false;
  #disposed = false;

  constructor(options: {
    readonly admit?: GltfPreparationJobAdmitter;
    readonly closeSource: (source: LoadedTextureSource) => void;
    readonly diagnostic: (message: string, key: string) => void;
    readonly invalidate: () => void;
    readonly now?: MonotonicClock;
    readonly decodeRecipe?: typeof decodePreparedGltfImageSourceRecipe;
    readonly prepareRecipe?: typeof prepareGltfImageSourceRecipe;
    readonly progress?: (assetKey: string) => void;
    readonly retainSource: (source: LoadedTextureSource) => SourceLease;
    readonly reserveTransportBytes?: (bytes: number) => TransportLease;
    readonly requiresTransport?: (recipe: GltfImageSourceRecipe) => boolean;
  }) {
    this.#closeSource = options.closeSource;
    this.#diagnostic = options.diagnostic;
    this.#iblScheduler = new GltfPreparationScheduler(GLTF_IBL_IMAGE_CONCURRENCY, options.admit);
    this.#invalidate = options.invalidate;
    this.#now = options.now ?? monotonicNowMs;
    this.#ordinaryScheduler = new GltfPreparationScheduler(GLTF_ORDINARY_IMAGE_CONCURRENCY, options.admit);
    this.#decodeRecipe = options.decodeRecipe ?? decodePreparedGltfImageSourceRecipe;
    this.#prepareRecipe = options.prepareRecipe ?? prepareGltfImageSourceRecipe;
    this.#progress = options.progress ?? (() => undefined);
    this.#retainSource = options.retainSource;
    this.#reserveTransportBytes = options.reserveTransportBytes;
    this.#requiresTransport = options.requiresTransport
      ?? (options.prepareRecipe === undefined ? gltfImageSourceRecipeRequiresTransport : () => true);
  }

  registerAsset(input: {
    readonly imageBasedLight?: SurfaceImageBasedLight;
    readonly key: string;
    readonly load: GltfLoadMetrics;
    readonly materials: readonly LoadedGltfMaterial[];
    readonly publicationGroups?: readonly (readonly LoadedGltfMaterial[])[];
    readonly recipeLease: GltfImageRecipeLease;
    readonly recipes: readonly GltfImageSourceRecipe[];
    readonly stateInstanceKey: number;
  }): void {
    if (this.#disposed) throw new Error("glTF image coordinator disposed");
    try {
      this.releaseAsset(input.key);
    } catch (error) {
      // releaseAsset logically removes the old generation before performing
      // exhaustive cleanup. Cleanup failure must not strand an otherwise
      // admissible replacement outside the coordinator.
      this.#diagnose(
        `glTF image replacement failed for ${input.key}: ${error instanceof Error ? error.message : String(error)}`,
        input.key,
      );
    }
    const registrationClaim = {};
    this.#registrationClaims.set(input.key, registrationClaim);
    const publications = new WeakMap<LoadedGltfMaterial, SurfaceMaterialPublication>();
    for (const group of input.publicationGroups ?? []) {
      const publication = {
        ready: group.every((material) => material.baseColorTexture?.imageUri === undefined),
      };
      for (const material of group) {
        publications.set(material, publication);
      }
    }
    const asset: Asset = {
      controller: new AbortController(),
      key: input.key,
      load: input.load,
      pendingMaterialRows: new WeakMap(),
      publications,
      recipeOwnership: {
        activeRecipes: new Set(),
        assetKey: input.key,
        lease: input.recipeLease,
        operationInProgress: false,
        releaseRequested: false,
        released: false,
        retainedRecipes: new Set(),
      },
      readyKeys: new Set(),
      rows: new Map(),
      settledMaterials: new WeakSet(),
      stateInstanceKey: input.stateInstanceKey,
    };
    const iblRows = new Map<string, SurfaceImageBasedLightSpecular>();
    const specular = input.imageBasedLight?.specular;
    if (specular !== undefined) {
      for (const mip of specular.imageLoadKeys) {
        for (const key of mip) iblRows.set(key, specular);
      }
    }
    for (const recipe of input.recipes) {
      const { key } = recipe;
      if (asset.rows.has(key)) continue;
      const iblSpecular = iblRows.get(key);
      const row: Row = {
        asset,
        bindings: [],
        ...(iblSpecular === undefined ? {} : { iblSpecular }),
        key,
        materials: new Set(),
        outcomeQueued: false,
        referencesRekeyed: false,
        recipe,
        status: "idle",
        transportSettled: false,
      };
      asset.rows.set(key, row);
      asset.recipeOwnership.retainedRecipes.add(recipe);
    }
    // Ownership transfers only after the initial exact-size shrink succeeds.
    // A failed resize leaves the caller's original lease untouched.
    try {
      input.recipeLease.resize(gltfImageSourceRecipeBytes(asset.recipeOwnership.retainedRecipes));
    } catch (error) {
      if (this.#registrationClaims.get(input.key) === registrationClaim) {
        this.#registrationClaims.delete(input.key);
      }
      throw error;
    }
    if (
      this.#disposed
      || this.#registrationClaims.get(input.key) !== registrationClaim
    ) {
      input.recipeLease.release();
      throw new Error(`glTF image registration superseded for ${input.key}`);
    }
    this.#bindMaterialRows(asset, input.materials);
    for (const material of input.materials) {
      if ((asset.pendingMaterialRows.get(material) ?? 0) === 0) {
        asset.settledMaterials.add(material);
      }
    }
    asset.load.imageCandidates = asset.rows.size;
    this.#assets.set(input.key, asset);
    this.#registrationClaims.delete(input.key);
    // Lighting faces define the environment for every material and must be
    // available independently of visibility. Ordinary material images remain
    // dormant until demandMaterial publishes a selected material.
    for (const row of asset.rows.values()) {
      if (row.iblSpecular !== undefined) this.#demand(row);
    }
  }

  /** Demands only the ordinary images referenced by one selected material. */
  demandMaterial(assetKey: string, material: LoadedGltfMaterial): boolean {
    const asset = this.#assets.get(assetKey);
    if (asset === undefined || asset.settledMaterials.has(material)) return false;
    const baseKey = material.baseColorTexture?.imageUri;
    if (baseKey !== undefined) {
      const base = asset.rows.get(baseKey);
      this.#demand(base);
      if (base?.status === "loading" || base?.status === "queued") {
        (base.pendingRefinements ??= new Set()).add(material);
        return true;
      }
    }
    this.#demandMaterialRefinements(asset, material);
    return false;
  }

  #demandMaterialRefinements(asset: Asset, material: LoadedGltfMaterial): void {
    const demand = (slot: LoadedGltfMaterialTextureSlot | undefined): void => {
      if (slot?.imageUri !== undefined) this.#demand(asset.rows.get(slot.imageUri));
    };
    for (const [key] of GLTF_CORE_MATERIAL_TEXTURES) {
      if (key !== "baseColorTexture") demand(material[key]);
    }
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      demand(material.extensionTextures?.[texture.key]);
    }
  }

  #demandSettledBaseRefinements(row: Row): void {
    const materials = row.pendingRefinements;
    if (materials === undefined) return;
    delete row.pendingRefinements;
    for (const material of materials) this.#demandMaterialRefinements(row.asset, material);
  }

  readyKeys(assetKey: string): ReadonlySet<string> {
    return this.#assets.get(assetKey)?.readyKeys ?? EMPTY_IMAGE_KEYS;
  }

  publication(assetKey: string, material: LoadedGltfMaterial): SurfaceMaterialPublication | undefined {
    return this.#assets.get(assetKey)?.publications.get(material);
  }

  /** Borrows retryable outcomes; entries remain owned until explicitly acknowledged. */
  pendingReadyOutcomes(): readonly GltfImageReadyOutcome[] {
    const outcomes: GltfImageReadyOutcome[] = [];
    for (const row of this.#pendingOutcomes) {
      const asset = this.#assets.get(row.asset.key);
      const source = row.source;
      const lease = row.sourceLease;
      if (asset !== row.asset || asset.rows.get(row.key) !== row || source === undefined || lease === undefined) {
        continue;
      }
      outcomes.push({
        acknowledge: () => this.#acknowledge(row, source, lease),
        assetKey: asset.key,
        bindings: row.bindings,
        ...(row.contentKey === undefined ? {} : { contentKey: row.contentKey }),
        ...(row.iblSpecular === undefined ? {} : { iblSpecular: row.iblSpecular }),
        key: row.key,
        markReferencesRekeyed: () => {
          if (
            this.#assets.get(asset.key) === asset
            && asset.rows.get(row.key) === row
            && row.source === source
            && row.sourceLease === lease
          ) row.referencesRekeyed = true;
        },
        materials: row.materials,
        get referencesRekeyed() { return row.referencesRekeyed; },
        source,
        stateInstanceKey: asset.stateInstanceKey,
      });
    }
    return outcomes;
  }

  releaseAsset(key: string): void {
    this.#registrationClaims.delete(key);
    const asset = this.#assets.get(key);
    if (asset === undefined) return;
    let failure: CapturedFailure | undefined;
    const cleanup = (operation: () => void): void => {
      failure = captureFirstFailure(failure, operation);
    };
    this.#assets.delete(key);
    asset.controller.abort();
    const ownership = asset.recipeOwnership;
    ownership.releaseRequested = true;
    this.#recipeCleanupDebt.add(ownership);
    for (const row of asset.rows.values()) {
      cleanup(() => this.#releaseRowSource(row));
    }
    asset.rows.clear();
    for (let index = this.#pendingOutcomes.length - 1; index >= 0; index -= 1) {
      if (this.#pendingOutcomes[index]?.asset !== asset) continue;
      this.#pendingOutcomes.splice(index, 1);
    }
    const inactiveRecipes = [...ownership.retainedRecipes].filter((recipe) =>
      !ownership.activeRecipes.has(recipe));
    // With no in-flight closure, full release is both exact and less fallible
    // than an otherwise redundant shrink followed by release.
    if (ownership.activeRecipes.size !== 0) {
      cleanup(() => this.#forgetRecipes(ownership, inactiveRecipes));
    }
    cleanup(() => this.#releaseRecipesIfUnused(ownership));
    // A detached source or recipe may fail after this asset has no remaining
    // jobs capable of reaching their `finally` retry hook.
    this.#scheduleCleanupRetry();
    if (failure !== undefined) throw failure.value;
  }

  dispose(): void {
    let failure: CapturedFailure | undefined;
    const cleanup = (operation: () => void): void => {
      failure = captureFirstFailure(failure, operation);
    };
    cleanup(() => this.#retryCleanupDebt());
    if (this.#disposed) {
      if (failure !== undefined) throw failure.value;
      return;
    }
    this.#disposed = true;
    this.#registrationClaims.clear();
    for (const key of this.#assets.keys()) {
      cleanup(() => this.releaseAsset(key));
    }
    cleanup(() => this.#ordinaryScheduler.dispose());
    cleanup(() => this.#iblScheduler.dispose());
    cleanup(() => this.#transportScheduler.dispose());
    this.#pendingOutcomes.length = 0;
    if (failure !== undefined) throw failure.value;
  }

  wake(): void {
    if (!this.#disposed) {
      this.#ordinaryScheduler.wake();
      this.#iblScheduler.wake();
      this.#transportScheduler.wake();
    }
    for (const asset of this.#assets.values()) {
      try {
        this.#releaseSettledRecipes(asset);
      } catch (error) {
        this.#diagnoseRecipeReleaseFailure(asset, error);
      }
    }
    try {
      this.#retryCleanupDebt();
    } catch (error) {
      this.#diagnose(
        `glTF image cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        "detached-cleanup",
      );
    }
  }

  snapshot(): GltfImageDemandCoordinatorSnapshot {
    let candidates = 0;
    let dormant = 0;
    let errors = 0;
    let loading = 0;
    let queued = 0;
    let ready = 0;
    for (const asset of this.#assets.values()) {
      for (const row of asset.rows.values()) {
        candidates += 1;
        switch (row.status) {
          case "idle": dormant += 1; break;
          case "queued": queued += 1; break;
          case "loading": loading += 1; break;
          case "ready": ready += 1; break;
          case "error": errors += 1; break;
        }
      }
    }
    const ordinary = this.#ordinaryScheduler.snapshot();
    const ibl = this.#iblScheduler.snapshot();
    const transport = this.#transportScheduler.snapshot();
    return {
      active: ordinary.active + ibl.active + transport.active,
      candidates,
      dormant,
      errors,
      iblQueueHighWater: ibl.queueHighWater,
      loading,
      ordinaryQueueHighWater: ordinary.queueHighWater + transport.queueHighWater,
      queueHighWater: ordinary.queueHighWater + ibl.queueHighWater + transport.queueHighWater,
      queued,
      ready,
    };
  }

  #bindMaterialRows(asset: Asset, materials: readonly LoadedGltfMaterial[]): void {
    const bind = (
      slot: LoadedGltfMaterialTextureSlot | undefined,
      binding: Omit<GltfImageTextureBinding, "contentKey" | "count" | "material" | "sampler" | "sourceUri" | "textureUri">,
      material: LoadedGltfMaterial,
    ): void => {
      if (slot?.imageUri === undefined || slot.textureUri === undefined) return;
      const row = asset.rows.get(slot.imageUri);
      if (row === undefined) return;
      if (!row.materials.has(material)) {
        row.materials.add(material);
        asset.pendingMaterialRows.set(
          material,
          (asset.pendingMaterialRows.get(material) ?? 0) + 1,
        );
      }
      row.bindings.push({
        ...binding,
        ...(slot.contentKey === undefined ? {} : { contentKey: slot.contentKey }),
        count: 1,
        material,
        ...(slot.sampler === undefined ? {} : { sampler: slot.sampler }),
        ...(slot.sourceUri === undefined ? {} : { sourceUri: slot.sourceUri }),
        textureUri: slot.textureUri,
      });
    };
    for (const material of materials) {
      bind(material.baseColorTexture, { baseColor: true, colorSpace: "srgb" }, material);
      bind(material.emissiveTexture, { baseColor: false, colorSpace: "srgb" }, material);
      bind(material.metallicRoughnessTexture, { baseColor: false, colorSpace: "linear" }, material);
      bind(material.normalTexture, { baseColor: false, colorSpace: "linear" }, material);
      bind(material.occlusionTexture, { baseColor: false, colorSpace: "linear" }, material);
      for (const definition of GLTF_MATERIAL_EXTENSION_TEXTURES) {
        bind(
          material.extensionTextures?.[definition.key],
          { baseColor: false, colorSpace: definition.colorSpace },
          material,
        );
      }
    }
  }

  #acknowledge(row: Row, source: LoadedTextureSource, lease: SourceLease): void {
    const asset = row.asset;
    if (
      this.#assets.get(asset.key) !== asset
      || asset.rows.get(row.key) !== row
      || row.source !== source
      || row.sourceLease !== lease
    ) return;
    const pendingIndex = this.#pendingOutcomes.indexOf(row);
    if (pendingIndex >= 0) this.#pendingOutcomes.splice(pendingIndex, 1);
    row.outcomeQueued = false;
    this.#releaseRowSource(row);
  }

  #demand(row: Row | undefined): void {
    if (row === undefined) return;
    if (row.status !== "idle") return;
    const asset = row.asset;
    const recipe = row.recipe;
    if (recipe === undefined) return;
    const ownership = asset.recipeOwnership;
    row.status = "queued";
    ownership.activeRecipes.add(recipe);
    asset.load.imageLoadStartedAt ??= this.#now();
    asset.load.imageRequests += 1;
    const transport = row.iblSpecular === undefined ? this.#ordinaryTransport : this.#iblTransport;
    transport.queue.push(row);
    if (!this.#requiresTransport(recipe)) {
      row.prepared = preparedGltfImageSourceRecipeWithoutTransport(recipe);
      row.transportSettled = true;
      this.#pumpTransportQueue(transport);
      return;
    }
    void this.#transportScheduler.run(asset.controller.signal, () => {
      row.status = "loading";
      return this.#prepareRecipe(recipe, asset.controller.signal);
    }).then((prepared) => {
      if (prepared.transportBytes > 0) {
        const lease = this.#reserveTransportBytes?.(prepared.transportBytes);
        if (lease !== undefined) row.transportLease = lease;
      }
      row.prepared = prepared;
    }).catch((error: unknown) => { row.transportError = error; }).finally(() => {
      row.transportSettled = true;
      this.#pumpTransportQueue(transport);
    });
  }

  #pumpTransportQueue(lane: TransportLane): void {
    while (lane.head < lane.queue.length && lane.queue[lane.head]!.transportSettled) {
      const row = lane.queue[lane.head++]!;
      this.#beginDecode(row);
    }
    if (lane.head === lane.queue.length) {
      lane.queue.length = 0;
      lane.head = 0;
    }
  }

  #beginDecode(row: Row): void {
    const asset = row.asset;
    const recipe = row.recipe;
    const prepared = row.prepared;
    const transportError = row.transportError;
    delete row.prepared;
    delete row.transportError;
    if (recipe === undefined) return;
    if (this.#assets.get(asset.key) !== asset || asset.rows.get(row.key) !== row) {
      this.#finishImageJob(row, recipe);
      return;
    }
    if (transportError !== undefined || prepared === undefined) {
      if (!asset.controller.signal.aborted) {
        this.#settleImageFailure(row, transportError ?? new Error("glTF image transport produced no recipe"));
      }
      this.#finishImageJob(row, recipe);
      return;
    }
    row.status = "queued";
    const scheduler = row.iblSpecular === undefined ? this.#ordinaryScheduler : this.#iblScheduler;
    void scheduler.run(asset.controller.signal, () => {
      row.status = "loading";
      return this.#decodeRecipe(prepared, asset.controller.signal);
    }).then((loaded) => this.#settleImageReady(row, loaded)).catch((error: unknown) => {
      if (!asset.controller.signal.aborted) this.#settleImageFailure(row, error);
    }).finally(() => this.#finishImageJob(row, recipe));
  }

  #settleImageReady(row: Row, loaded: LoadedGltfImageSource): void {
    const asset = row.asset;
    if (this.#assets.get(asset.key) !== asset || asset.rows.get(row.key) !== row) {
      this.#releaseSource(loaded.image);
      return;
    }
    let sourceLease: SourceLease;
    try {
      sourceLease = this.#retainSource(loaded.image);
    } catch (error) {
      try {
        this.#releaseSource(loaded.image);
      } catch {
        // Preserve the retention failure. The detached source debt owns the
        // failed close and wake()/dispose() will retry it.
      }
      throw error;
    }
    if (this.#assets.get(asset.key) !== asset || asset.rows.get(row.key) !== row) {
      this.#releaseSource(loaded.image, sourceLease);
      return;
    }
    row.sourceLease = sourceLease;
    row.source = loaded.image;
    asset.readyKeys.add(row.key);
    if (loaded.contentKey === undefined) delete row.contentKey;
    else row.contentKey = loaded.contentKey;
    row.status = "ready";
    this.#settleMaterialDemandRow(row);
    this.#demandSettledBaseRefinements(row);
    this.#recordSettled(asset, false);
    if (!row.outcomeQueued) {
      row.outcomeQueued = true;
      this.#pendingOutcomes.push(row);
    }
    this.#requestInvalidate(row.key);
  }

  #settleImageFailure(row: Row, error: unknown): void {
    const asset = row.asset;
    if (this.#assets.get(asset.key) !== asset || asset.rows.get(row.key) !== row) return;
    row.error = error instanceof Error ? error.message : String(error);
    row.status = "error";
    (asset.load.imageFailureDetails ??= []).push({ key: row.key, message: row.error });
    this.#settleMaterialDemandRow(row);
    asset.readyKeys.delete(row.key);
    this.#demandSettledBaseRefinements(row);
    this.#recordSettled(asset, true);
    this.#diagnose(`glTF image load failed for ${row.key}: ${row.error}`, row.key);
    this.#requestInvalidate(row.key);
  }

  #finishImageJob(row: Row, recipe: GltfImageSourceRecipe): void {
    try {
      row.transportLease?.release();
    } catch (error) {
      this.#diagnose(
        `glTF image transport byte release failed for ${row.key}: ${error instanceof Error ? error.message : String(error)}`,
        row.key,
      );
    }
    delete row.transportLease;
    const asset = row.asset;
    asset.recipeOwnership.activeRecipes.delete(recipe);
    try {
      this.#releaseSettledRecipes(asset, [recipe]);
    } catch (error) {
      this.#diagnoseRecipeReleaseFailure(asset, error);
    }
    this.#scheduleCleanupRetry();
  }

  #recordSettled(asset: Asset, failed: boolean): void {
    if (failed) asset.load.imageFailures += 1;
    else asset.load.imageLoaded += 1;
    asset.load.firstImageSettledAt ??= this.#now();
    if (asset.load.imageLoaded + asset.load.imageFailures >= asset.load.imageRequests) {
      asset.load.imagesSettledAt = this.#now();
    }
    this.#requestProgress(asset.key);
  }

  #settleMaterialDemandRow(row: Row): void {
    const asset = row.asset;
    for (const material of row.materials) {
      const pending = asset.pendingMaterialRows.get(material);
      if (pending === undefined || pending <= 1) {
        asset.pendingMaterialRows.delete(material);
        asset.settledMaterials.add(material);
      } else {
        asset.pendingMaterialRows.set(material, pending - 1);
      }
    }
  }

  #releaseRecipesIfUnused(ownership: RecipeOwnership): void {
    if (
      ownership.released
      || ownership.operationInProgress
      || ownership.activeRecipes.size !== 0
      || (!ownership.releaseRequested && ownership.retainedRecipes.size !== 0)
    ) return;
    ownership.operationInProgress = true;
    try {
      ownership.lease.release();
    } finally {
      ownership.operationInProgress = false;
    }
    ownership.released = true;
    ownership.activeRecipes.clear();
    ownership.retainedRecipes.clear();
    this.#recipeCleanupDebt.delete(ownership);
  }

  #releaseSettledRecipes(
    asset: Asset,
    additional: readonly GltfImageSourceRecipe[] = [],
  ): void {
    const ownership = asset.recipeOwnership;
    const settledRecipes = new Set<GltfImageSourceRecipe>(additional);
    for (const row of asset.rows.values()) {
      if (
        row.recipe !== undefined
        && (row.status === "error" || row.status === "ready")
      ) settledRecipes.add(row.recipe);
    }
    this.#forgetRecipes(ownership, settledRecipes, asset.rows.values());
    this.#releaseRecipesIfUnused(ownership);
  }

  #diagnoseRecipeReleaseFailure(asset: Asset, error: unknown): void {
    this.#diagnose(
      `glTF image recipe release failed for ${asset.key}: ${error instanceof Error ? error.message : String(error)}`,
      asset.key,
    );
  }

  #forgetRecipes(
    ownership: RecipeOwnership,
    recipes: Iterable<GltfImageSourceRecipe>,
    rows?: Iterable<Row>,
  ): void {
    if (ownership.released || ownership.operationInProgress) return;
    const next = new Set(ownership.retainedRecipes);
    for (const recipe of recipes) next.delete(recipe);
    if (next.size === ownership.retainedRecipes.size) return;
    ownership.operationInProgress = true;
    try {
      ownership.lease.resize(gltfImageSourceRecipeBytes(next));
    } finally {
      ownership.operationInProgress = false;
    }
    for (const recipe of recipes) {
      if (!next.has(recipe)) ownership.retainedRecipes.delete(recipe);
    }
    if (rows !== undefined) {
      for (const row of rows) {
        if (row.recipe !== undefined && !ownership.retainedRecipes.has(row.recipe)) delete row.recipe;
      }
    }
  }

  #releaseRowSource(row: Row): void {
    const source = row.source;
    const lease = row.sourceLease;
    delete row.source;
    delete row.sourceLease;
    if (source === undefined || lease === undefined) return;
    this.#releaseSource(source, lease);
  }

  #releaseSource(source: LoadedTextureSource, lease?: SourceLease): void {
    const debt: SourceCleanupDebt = {
      closePending: lease === undefined,
      inProgress: false,
      lease,
      source,
    };
    this.#sourceCleanupDebt.add(debt);
    this.#retrySourceCleanup(debt);
  }

  #retryCleanupDebt(): void {
    let failure: CapturedFailure | undefined;
    const cleanup = (operation: () => void): void => {
      failure = captureFirstFailure(failure, operation);
    };
    for (const debt of Array.from(this.#sourceCleanupDebt)) {
      cleanup(() => this.#retrySourceCleanup(debt));
    }
    for (const ownership of Array.from(this.#recipeCleanupDebt)) {
      cleanup(() => this.#retryRecipeCleanup(ownership));
    }
    if (failure !== undefined) throw failure.value;
  }

  #retryRecipeCleanup(ownership: RecipeOwnership): void {
    if (ownership.released) {
      this.#recipeCleanupDebt.delete(ownership);
      return;
    }
    if (ownership.operationInProgress) return;
    if (ownership.activeRecipes.size !== 0) {
      this.#forgetRecipes(
        ownership,
        [...ownership.retainedRecipes].filter((recipe) =>
          !ownership.activeRecipes.has(recipe)),
      );
    }
    this.#releaseRecipesIfUnused(ownership);
  }

  #retrySourceCleanup(debt: SourceCleanupDebt): void {
    if (debt.inProgress) return;
    debt.inProgress = true;
    try {
      if (debt.lease !== undefined) {
        const lease = debt.lease;
        debt.lease = undefined;
        try {
          debt.closePending = lease.release();
        } catch (error) {
          debt.lease = lease;
          throw error;
        }
        if (!debt.closePending) {
          this.#sourceCleanupDebt.delete(debt);
          return;
        }
      }
      if (!debt.closePending) return;
      debt.closePending = false;
      try {
        this.#closeSource(debt.source);
      } catch (error) {
        debt.closePending = true;
        throw error;
      }
      this.#sourceCleanupDebt.delete(debt);
    } finally {
      debt.inProgress = false;
    }
  }

  #scheduleCleanupRetry(): void {
    if (
      this.#cleanupRetryScheduled
      || (this.#sourceCleanupDebt.size === 0 && this.#recipeCleanupDebt.size === 0)
    ) return;
    this.#cleanupRetryScheduled = true;
    queueMicrotask(() => {
      this.#cleanupRetryScheduled = false;
      try {
        this.#retryCleanupDebt();
      } catch (error) {
        this.#diagnose(
          `glTF image cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          "detached-cleanup",
        );
      }
    });
  }

  #diagnose(message: string, key: string): void {
    try {
      this.#diagnostic(message, key);
    } catch {
      // Diagnostic observers cannot alter renderer ownership or async state.
    }
  }

  #requestInvalidate(key: string): void {
    try {
      this.#invalidate();
    } catch (error) {
      this.#diagnose(
        `glTF image invalidation failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
        key,
      );
    }
  }

  #requestProgress(key: string): void {
    try {
      this.#progress(key);
    } catch (error) {
      this.#diagnose(
        `glTF image progress failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
        key,
      );
    }
  }
}
