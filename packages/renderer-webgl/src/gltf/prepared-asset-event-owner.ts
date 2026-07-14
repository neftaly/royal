import type { TextureContentKey } from "@royal/renderer-core";
import type { CountedTextureDeclaration, FramePlan } from "../frame-plan";
import {
  geometryDeclarationBucketKey,
  gltfGeometryDeclaration,
} from "../geometry-recipes";
import { GeometryRecipeRegistry } from "../geometry-recipe-registry";
import {
  applyPreparedAssetEvents,
  resourceArenaHasPendingAssetEvents,
  type PreparedAssetArenaEvent,
  type PreparedAssetDependencyManifest,
  type ResourceArena,
  type ResourceArenaChanges,
} from "../resource-arena";
import { gltfImageSourceRecipeBytes } from "./image-source-recipe";
import type { GltfImageRecipeLease } from "./image-demand-coordinator";
import type { GltfPacketOccurrence } from "../gltf-packet-topology";
import { gltfMaterialTextureRefs } from "./material-preparation-arena";
import type {
  LoadedGltfMaterial,
  LoadedGltfPrimitive,
  PreparedGltfAsset,
} from "./prepared-asset";
import { PreparedGltfRuntime } from "./prepared-runtime";
import { textureCacheKey, type TextureAssetUploadRef } from "../webgl/materials";

const preparedPrimitiveMaterials = (
  primitives: readonly LoadedGltfPrimitive[],
): readonly LoadedGltfMaterial[] => {
  const materials = new Set<LoadedGltfMaterial>();
  for (const primitive of primitives) {
    materials.add(primitive.material);
    for (const material of primitive.materialLod?.levels ?? []) materials.add(material);
    for (const variant of primitive.materialVariants ?? []) {
      materials.add(variant.material);
      for (const material of variant.materialLod?.levels ?? []) materials.add(material);
    }
  }
  return [...materials];
};

const preparedAssetMaterials = (asset: PreparedGltfAsset): readonly LoadedGltfMaterial[] =>
  preparedPrimitiveMaterials(asset.primitives);

type PreparedAssetEventOwnerOptions = {
  readonly applyResourceChanges: (changes: ResourceArenaChanges) => void;
  readonly detachImagePreparation: (assetKey: string, generation: number) => void;
  readonly disposed: () => boolean;
  readonly drainResourceSideEffects: () => void;
  readonly geometryRecipes: GeometryRecipeRegistry;
  readonly packetOccurrence: (plan: FramePlan, occurrenceIndex: number) => GltfPacketOccurrence;
  readonly plan: () => FramePlan | undefined;
  readonly recordDiagnostic: (message: string, key: string) => void;
  readonly resourceArena: ResourceArena;
  readonly runtime: PreparedGltfRuntime;
};

const nowMs = (): number => globalThis.performance?.now?.() ?? Date.now();

/** Owns prepared-asset dependency publication and generation-safe event handoff. */
export class PreparedAssetEventOwner {
  readonly #options: PreparedAssetEventOwnerOptions;

  constructor(options: PreparedAssetEventOwnerOptions) {
    this.#options = options;
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
  ): PreparedAssetDependencyManifest {
    const geometries = asset.primitives.map((primitive, index) => {
      const declaration = gltfGeometryDeclaration({
        ...(primitive.colors === undefined ? {} : { colors: primitive.colors }),
        ...(primitive.indices === undefined ? {} : { indices: primitive.indices }),
        mode: primitive.mode,
        ...(primitive.normals === undefined ? {} : { normals: primitive.normals }),
        positions: primitive.positions,
        ...(primitive.tangents === undefined ? {} : { tangents: primitive.tangents }),
        ...(primitive.texCoords0 === undefined ? {} : { texCoords0: primitive.texCoords0 }),
        ...(primitive.texCoords1 === undefined ? {} : { texCoords1: primitive.texCoords1 }),
      });
      const key = JSON.stringify([
        "gltf-geometry-owner-v1",
        assetKey,
        primitive.key,
        index,
        geometryDeclarationBucketKey(declaration),
      ]);
      this.#options.geometryRecipes.associateGltfPrimitiveKey(primitive, key);
      return { count: 1, declaration, key };
    });
    return {
      ...this.#materialDependencyManifest(preparedAssetMaterials(asset), contentKeys),
      geometries,
      iblKeys: asset.imageBasedLight?.specular === undefined
        ? []
        : [{ count: 1, key: asset.imageBasedLight.specular.key }],
      wantsHdr: asset.lights.length !== 0 || asset.imageBasedLight !== undefined,
    };
  }

  #materialDependencyManifest(
    materials: readonly LoadedGltfMaterial[],
    contentKeys: ReadonlyMap<string, TextureContentKey>,
  ): PreparedAssetDependencyManifest {
    const byKey = new Map<string, CountedTextureDeclaration<TextureAssetUploadRef> & { count: number }>();
    const ordinaryTextures: Array<CountedTextureDeclaration<TextureAssetUploadRef> & { count: number }> = [];
    for (const material of materials) {
      for (const texture of gltfMaterialTextureRefs(material, contentKeys)) {
        const key = textureCacheKey(texture);
        const existing = byKey.get(key);
        if (existing === undefined) {
          const entry = { count: 1, key, texture };
          byKey.set(key, entry);
          ordinaryTextures.push(entry);
        } else existing.count += 1;
      }
    }
    return { geometries: [], iblKeys: [], ordinaryTextures, virtualTextures: [], wantsHdr: false };
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
      state.load.readyAt = nowMs();
      this.#options.recordDiagnostic(snapshot.error, `gltf-asset:${state.key}`);
      const currentPlan = this.#currentPlan();
      if (currentPlan !== undefined) runtime.publishPacketError(snapshot.key, currentPlan.revision);
      return;
    }
    if (snapshot.status !== "ready") return;
    const asset = snapshot.asset;
    this.#releaseImageAssetForReplacement(snapshot.key);
    const replacesReadyAsset = state.status === "ready";
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
      state.load.readyAt = nowMs();
      this.#options.recordDiagnostic(state.error, `gltf-packets:${state.key}`);
      if (asset.imagePreparation !== undefined) {
        this.#options.detachImagePreparation(snapshot.key, snapshot.generation);
        runtime.releaseDecodeLease(snapshot.key);
      }
      return;
    }
    const images = asset.imagePreparation;
    if (images === undefined) return;
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
      state.load.readyAt = nowMs();
      this.#options.recordDiagnostic(state.error, `gltf-images:${state.key}`);
    }
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
