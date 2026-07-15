import type {
  TextureColorSpace,
  TextureContentKey,
  TextureSampler,
} from "@royal/renderer-core";
import type { LoadedTextureSource } from "../texture-sources";
import { captureFirstFailure, type CapturedFailure } from "../captured-failure";
import type {
  SurfaceImageBasedLight,
  SurfaceImageBasedLightSpecular,
} from "../webgl/lights";
import {
  GltfPreparationScheduler,
  type GltfPreparationJobAdmitter,
} from "./preparation-scheduler";
import type {
  GltfLoadMetrics,
  LoadedGltfMaterial,
  LoadedGltfMaterialTextureSlot,
} from "./prepared-asset";
import { GLTF_MATERIAL_EXTENSION_TEXTURES } from "./scene-reader";
import {
  gltfImageSourceRecipeBytes,
  loadGltfImageSourceRecipe,
  type GltfImageSourceRecipe,
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
  referencesRekeyed: boolean;
  recipe?: GltfImageSourceRecipe;
  source?: LoadedTextureSource;
  sourceLease?: SourceLease;
  status: RowStatus;
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
  readonly recipeOwnership: RecipeOwnership;
  readonly rows: Map<string, Row>;
  readonly stateInstanceKey: number;
};

const GLTF_IMAGE_LANE_CONCURRENCY = 1;
const nowMs = (): number => globalThis.performance?.now?.() ?? Date.now();

const imageDemandKeys = (
  materials: readonly LoadedGltfMaterial[],
  imageBasedLight: SurfaceImageBasedLight | undefined,
): ReadonlySet<string> => {
  const keys = new Set<string>();
  const add = (slot: LoadedGltfMaterialTextureSlot | undefined): void => {
    if (slot?.imageUri !== undefined) keys.add(slot.imageUri);
  };
  for (const material of materials) {
    add(material.baseColorTexture);
    add(material.emissiveTexture);
    add(material.metallicRoughnessTexture);
    add(material.normalTexture);
    add(material.occlusionTexture);
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      add(material.extensionTextures?.[texture.key]);
    }
  }
  for (const mip of imageBasedLight?.specular?.imageLoadKeys ?? []) {
    for (const key of mip) keys.add(key);
  }
  return keys;
};

export const gltfImageDemandKeys = imageDemandKeys;

export class GltfImageDemandCoordinator {
  readonly #assets = new Map<string, Asset>();
  readonly #closeSource: (source: LoadedTextureSource) => void;
  readonly #diagnostic: (message: string, key: string) => void;
  readonly #iblScheduler: GltfPreparationScheduler;
  readonly #invalidate: () => void;
  readonly #ordinaryScheduler: GltfPreparationScheduler;
  readonly #pendingOutcomes: Row[] = [];
  readonly #recipeCleanupDebt = new Set<RecipeOwnership>();
  readonly #registrationClaims = new Map<string, object>();
  readonly #retainSource: (source: LoadedTextureSource) => SourceLease;
  readonly #sourceCleanupDebt = new Set<SourceCleanupDebt>();
  #cleanupRetryScheduled = false;
  #disposed = false;

  constructor(options: {
    readonly admit?: GltfPreparationJobAdmitter;
    readonly closeSource: (source: LoadedTextureSource) => void;
    readonly diagnostic: (message: string, key: string) => void;
    readonly invalidate: () => void;
    readonly retainSource: (source: LoadedTextureSource) => SourceLease;
  }) {
    this.#closeSource = options.closeSource;
    this.#diagnostic = options.diagnostic;
    this.#iblScheduler = new GltfPreparationScheduler(GLTF_IMAGE_LANE_CONCURRENCY, options.admit);
    this.#invalidate = options.invalidate;
    this.#ordinaryScheduler = new GltfPreparationScheduler(GLTF_IMAGE_LANE_CONCURRENCY, options.admit);
    this.#retainSource = options.retainSource;
  }

  registerAsset(input: {
    readonly imageBasedLight?: SurfaceImageBasedLight;
    readonly key: string;
    readonly load: GltfLoadMetrics;
    readonly materials: readonly LoadedGltfMaterial[];
    readonly recipeLease: GltfImageRecipeLease;
    readonly recipes: readonly GltfImageSourceRecipe[];
    readonly stateInstanceKey: number;
  }): void {
    if (this.#disposed) throw new Error("glTF image demand coordinator is disposed");
    try {
      this.releaseAsset(input.key);
    } catch (error) {
      // releaseAsset logically removes the old generation before performing
      // exhaustive cleanup. Cleanup failure must not strand an otherwise
      // admissible replacement outside the coordinator.
      this.#diagnose(
        `glTF image asset replacement cleanup failed for ${input.key}: ${error instanceof Error ? error.message : String(error)}`,
        input.key,
      );
    }
    const registrationClaim = {};
    this.#registrationClaims.set(input.key, registrationClaim);
    const asset: Asset = {
      controller: new AbortController(),
      key: input.key,
      load: input.load,
      recipeOwnership: {
        activeRecipes: new Set(),
        assetKey: input.key,
        lease: input.recipeLease,
        operationInProgress: false,
        releaseRequested: false,
        released: false,
        retainedRecipes: new Set(),
      },
      rows: new Map(),
      stateInstanceKey: input.stateInstanceKey,
    };
    const iblRows = new Map<string, SurfaceImageBasedLightSpecular>();
    const specular = input.imageBasedLight?.specular;
    if (specular !== undefined) {
      for (const mip of specular.imageLoadKeys) {
        for (const key of mip) iblRows.set(key, specular);
      }
    }
    const demandedKeys = imageDemandKeys(input.materials, input.imageBasedLight);
    for (const recipe of input.recipes) {
      const { key } = recipe;
      if (!demandedKeys.has(key) || asset.rows.has(key)) continue;
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
      };
      asset.rows.set(key, row);
      asset.recipeOwnership.retainedRecipes.add(recipe);
    }
    // Ownership transfers only after the initial exact-size shrink succeeds.
    // A failed resize leaves the caller's original lease untouched.
    try {
      input.recipeLease.resize(gltfImageSourceRecipeBytes([
        ...asset.recipeOwnership.retainedRecipes,
      ]));
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
      throw new Error(`glTF image asset registration was superseded for ${input.key}`);
    }
    this.#bindMaterialRows(asset, input.materials);
    this.#assets.set(input.key, asset);
    this.#registrationClaims.delete(input.key);
    // Lighting faces define the environment for every material and must be
    // available independently of visibility. Ordinary material images remain
    // dormant until demandMaterial publishes a selected material.
    for (const row of asset.rows.values()) {
      if (row.iblSpecular !== undefined) this.#demand(row);
    }
  }

  demandAll(assetKey: string): void {
    const asset = this.#assets.get(assetKey);
    if (asset === undefined) return;
    for (const row of asset.rows.values()) this.#demand(row);
    if (asset.rows.size === 0) {
      asset.load.imagesSettledAt = nowMs();
      asset.recipeOwnership.releaseRequested = true;
      this.#releaseRecipesIfUnused(asset.recipeOwnership);
    }
  }

  /** Demands only the ordinary images referenced by one selected material. */
  demandMaterial(assetKey: string, material: LoadedGltfMaterial): void {
    const asset = this.#assets.get(assetKey);
    if (asset === undefined) return;
    const demand = (slot: LoadedGltfMaterialTextureSlot | undefined): void => {
      if (slot?.imageUri !== undefined) this.#demand(asset.rows.get(slot.imageUri));
    };
    demand(material.baseColorTexture);
    demand(material.emissiveTexture);
    demand(material.metallicRoughnessTexture);
    demand(material.normalTexture);
    demand(material.occlusionTexture);
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      demand(material.extensionTextures?.[texture.key]);
    }
  }

  imageReady(assetKey: string, imageKey: string): boolean {
    return this.#assets.get(assetKey)?.rows.get(imageKey)?.status === "ready";
  }

  demandImage(assetKey: string, imageKey: string): void {
    const row = this.#assets.get(assetKey)?.rows.get(imageKey);
    if (row !== undefined) this.#demand(row);
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
    this.#pendingOutcomes.length = 0;
    if (failure !== undefined) throw failure.value;
  }

  wake(): void {
    if (!this.#disposed) {
      this.#ordinaryScheduler.wake();
      this.#iblScheduler.wake();
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
        `glTF image detached cleanup retry failed: ${error instanceof Error ? error.message : String(error)}`,
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
    return {
      active: ordinary.active + ibl.active,
      candidates,
      dormant,
      errors,
      iblQueueHighWater: ibl.queueHighWater,
      loading,
      ordinaryQueueHighWater: ordinary.queueHighWater,
      queueHighWater: ordinary.queueHighWater + ibl.queueHighWater,
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
      row.materials.add(material);
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
    asset.load.imageLoadStartedAt ??= nowMs();
    asset.load.imageRequests += 1;
    const scheduler = row.iblSpecular === undefined ? this.#ordinaryScheduler : this.#iblScheduler;
    void scheduler.run(asset.controller.signal, () => {
      row.status = "loading";
      return loadGltfImageSourceRecipe(recipe, asset.controller.signal);
    }).then((loaded) => {
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
      if (loaded.contentKey === undefined) delete row.contentKey;
      else row.contentKey = loaded.contentKey;
      row.status = "ready";
      this.#recordSettled(asset, false);
      if (!row.outcomeQueued) {
        row.outcomeQueued = true;
        this.#pendingOutcomes.push(row);
      }
      this.#requestInvalidate(row.key);
    }).catch((error: unknown) => {
      if (this.#assets.get(asset.key) !== asset || asset.rows.get(row.key) !== row) return;
      if (asset.controller.signal.aborted) return;
      row.error = error instanceof Error ? error.message : String(error);
      row.status = "error";
      this.#recordSettled(asset, true);
      this.#diagnose(`glTF image load failed for ${row.key}: ${row.error}`, row.key);
      this.#requestInvalidate(row.key);
    }).finally(() => {
      ownership.activeRecipes.delete(recipe);
      try {
        this.#releaseSettledRecipes(asset, [recipe]);
      } catch (error) {
        this.#diagnoseRecipeReleaseFailure(asset, error);
      }
      this.#scheduleCleanupRetry();
    });
  }

  #recordSettled(asset: Asset, failed: boolean): void {
    if (failed) asset.load.imageFailures += 1;
    else asset.load.imageLoaded += 1;
    asset.load.firstImageSettledAt ??= nowMs();
    if (asset.load.imageLoaded + asset.load.imageFailures >= asset.load.imageRequests) {
      asset.load.imagesSettledAt = nowMs();
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
    this.#forgetRecipes(ownership, [...settledRecipes], asset.rows.values());
    this.#releaseRecipesIfUnused(ownership);
  }

  #diagnoseRecipeReleaseFailure(asset: Asset, error: unknown): void {
    this.#diagnose(
      `glTF image recipe lease release failed for ${asset.key}: ${error instanceof Error ? error.message : String(error)}`,
      asset.key,
    );
  }

  #forgetRecipes(
    ownership: RecipeOwnership,
    recipes: readonly GltfImageSourceRecipe[],
    rows: Iterable<Row> = [],
  ): void {
    if (ownership.released || ownership.operationInProgress || recipes.length === 0) return;
    const next = new Set(ownership.retainedRecipes);
    for (const recipe of recipes) next.delete(recipe);
    if (next.size === ownership.retainedRecipes.size) return;
    ownership.operationInProgress = true;
    try {
      ownership.lease.resize(gltfImageSourceRecipeBytes([...next]));
    } finally {
      ownership.operationInProgress = false;
    }
    for (const recipe of recipes) {
      if (!next.has(recipe)) ownership.retainedRecipes.delete(recipe);
    }
    for (const row of rows) {
      if (row.recipe !== undefined && !ownership.retainedRecipes.has(row.recipe)) delete row.recipe;
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
          `glTF image detached cleanup retry failed: ${error instanceof Error ? error.message : String(error)}`,
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
        `glTF image invalidation observer failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
        key,
      );
    }
  }
}
