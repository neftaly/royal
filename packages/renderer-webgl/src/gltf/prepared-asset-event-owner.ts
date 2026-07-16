import type { TextureContentKey } from "@royal/renderer-core";
import { monotonicNowMs, type MonotonicClock } from "../clock";
import type { FramePlan } from "../frame/plan";
import { GeometryRecipeRegistry } from "../geometry-recipe-registry";
import {
  applyPreparedAssetEvents,
  resourceArenaHasPendingAssetEvents,
  type PreparedAssetArenaEvent,
  type ResourceArena,
  type ResourceArenaChanges,
} from "../resource-arena";
import { gltfImageSourceRecipeBytes } from "./image-source-recipe";
import type { GltfImageRecipeLease } from "./image-demand-coordinator";
import type { GltfPacketOccurrence } from "../gltf-packet-topology";
import type { PreparedGltfAsset } from "./prepared-asset";
import { planPreparedAssetDependencies } from "./prepared-asset-dependencies";
import {
  preparedAssetMaterials,
  preparedGltfMaterialPublicationGroups,
} from "./prepared-asset-materials";
import { PreparedGltfRuntime } from "./prepared-runtime";

type PreparedAssetEventOwnerOptions = {
  readonly applyResourceChanges: (changes: ResourceArenaChanges) => void;
  readonly detachImagePreparation: (assetKey: string, generation: number) => void;
  readonly disposed: () => boolean;
  readonly drainResourceSideEffects: () => void;
  readonly geometryRecipes: GeometryRecipeRegistry;
  readonly now?: MonotonicClock;
  readonly packetOccurrence: (plan: FramePlan, occurrenceIndex: number) => GltfPacketOccurrence;
  readonly plan: () => FramePlan | undefined;
  readonly recordDiagnostic: (message: string, key: string) => void;
  readonly resourceArena: ResourceArena;
  readonly runtime: PreparedGltfRuntime;
};

/** Owns prepared-asset dependency publication and generation-safe event handoff. */
export class PreparedAssetEventOwner {
  readonly #now: MonotonicClock;
  readonly #options: PreparedAssetEventOwnerOptions;

  constructor(options: PreparedAssetEventOwnerOptions) {
    this.#options = options;
    this.#now = options.now ?? monotonicNowMs;
  }

  applyPending(): void {
    const runtime = this.#options.runtime;
    if (runtime.eventDrainInProgress) return;
    this.#options.drainResourceSideEffects();
    // Retained events belong to the already-applied arena generation. Drain
    // them before admitting newer events so same-key revisions stay ordered.
    this.#drain();
    if (resourceArenaHasPendingAssetEvents(this.#options.resourceArena)) {
      const applied = applyPreparedAssetEvents(
        this.#options.resourceArena,
        (asset, contentKeys, assetKey) => this.#dependencyManifest(asset, contentKeys, assetKey),
      );
      runtime.enqueueEvents(applied.events);
      this.#options.applyResourceChanges(applied.changes);
    }
    this.#drain();
  }

  #drain(): void {
    this.#options.runtime.drainEvents((event) => this.#apply(event));
  }

  #dependencyManifest(
    asset: PreparedGltfAsset,
    contentKeys: ReadonlyMap<string, TextureContentKey>,
    assetKey: string,
  ) {
    const dependencyPlan = planPreparedAssetDependencies(asset, contentKeys, assetKey);
    for (const association of dependencyPlan.geometryAssociations) {
      this.#options.geometryRecipes.associateGltfPrimitiveKey(
        association.primitive,
        association.key,
      );
    }
    return dependencyPlan.manifest;
  }

  #apply(event: PreparedAssetArenaEvent): void {
    const snapshot = event.snapshot;
    const runtime = this.#options.runtime;
    const state = runtime.get(snapshot.key);
    if (state === undefined || state.preparedGeneration !== snapshot.generation) return;
    if (snapshot.status === "error") {
      this.#releaseImageAssetForReplacement(snapshot.key);
      state.status = "error";
      state.error = snapshot.error;
      state.load.readyAt = this.#now();
      this.#options.recordDiagnostic(snapshot.error, `gltf-asset:${state.key}`);
      const currentPlan = this.#currentPlan();
      if (currentPlan !== undefined) runtime.publishPacketError(snapshot.key, currentPlan.revision);
      runtime.publishStateChange(state.key);
      return;
    }
    if (snapshot.status !== "ready") return;
    const asset = snapshot.asset;
    this.#releaseImageAssetForReplacement(snapshot.key);
    const replacesReadyAsset = state.status === "ready";
    if (asset.bounds === undefined) delete state.bounds;
    else state.bounds = asset.bounds;
    state.hasMaterialLod = asset.hasMaterialLod;
    state.hasMaterialVariants = asset.hasMaterialVariants;
    state.hasNodeLod = asset.hasNodeLod;
    if (asset.imageBasedLight === undefined) delete state.imageBasedLight;
    else state.imageBasedLight = asset.imageBasedLight;
    state.lights = asset.lights;
    state.materials = preparedAssetMaterials(asset);
    state.load = asset.load;
    delete state.error;
    state.nodeCount = asset.nodeCount;
    state.primitives = asset.primitives;
    state.status = "ready";
    state.variants = asset.variants;
    const plan = this.#currentPlan();
    try {
      runtime.publishReadyPackets(
        snapshot.key,
        plan?.revision,
        replacesReadyAsset,
        (occurrenceIndex) => this.#options.packetOccurrence(plan!, occurrenceIndex),
      );
    } catch (error) {
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
      state.load.readyAt = this.#now();
      this.#options.recordDiagnostic(state.error, `gltf-packets:${state.key}`);
      if (asset.imagePreparation !== undefined) {
        this.#options.detachImagePreparation(snapshot.key, snapshot.generation);
        runtime.releaseDecodeLease(snapshot.key);
      }
      runtime.publishStateChange(state.key);
      return;
    }
    const images = asset.imagePreparation;
    if (images === undefined) {
      runtime.publishStateChange(state.key);
      return;
    }
    const eventIsCurrent = (): boolean =>
      !this.#options.disposed()
      && runtime.get(snapshot.key) === state
      && state.preparedGeneration === snapshot.generation;
    let recipeLease: GltfImageRecipeLease | undefined;
    try {
      recipeLease = runtime.takeDecodeRecipeLease(
        state.key,
        gltfImageSourceRecipeBytes(images.recipes),
      );
      runtime.images.registerAsset({
        ...(state.imageBasedLight === undefined ? {} : { imageBasedLight: state.imageBasedLight }),
        key: state.key,
        load: state.load,
        materials: state.materials,
        publicationGroups: preparedGltfMaterialPublicationGroups(asset.primitives),
        recipeLease,
        recipes: images.recipes,
        stateInstanceKey: state.instanceKey,
      });
      if (!eventIsCurrent()) {
        this.#releaseImageAssetForReplacement(state.key);
        return;
      }
      this.#options.detachImagePreparation(snapshot.key, snapshot.generation);
    } catch (error) {
      recipeLease?.release();
      if (!eventIsCurrent()) return;
      this.#options.detachImagePreparation(snapshot.key, snapshot.generation);
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
      state.load.readyAt = this.#now();
      this.#options.recordDiagnostic(state.error, `gltf-images:${state.key}`);
    }
    runtime.publishStateChange(state.key);
  }

  #currentPlan(): FramePlan | undefined {
    return this.#options.plan();
  }

  #releaseImageAssetForReplacement(key: string): void {
    try {
      this.#options.runtime.images.releaseAsset(key);
    } catch (error) {
      this.#options.recordDiagnostic(
        `glTF image asset cleanup failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
        `gltf-image-cleanup:${key}`,
      );
    }
  }
}
