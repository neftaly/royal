import type { ImageBasedLightingRootFeature } from "../image-based-lighting-feature";
import { OrdinaryTextureResidencyController } from "../texture/ordinary-residency-controller";
import {
  publishResourceArenaContentKey,
  rekeyPreparedAssetOrdinaryTextures,
  type PreparedAssetOrdinaryTextureRekey,
  type ResourceArena,
  type ResourceArenaChanges,
} from "../resource-arena";
import { textureCacheKey, type TextureAssetUploadRef } from "../webgl/materials";
import { GltfMaterialPreparationArena } from "./material-preparation-arena";
import { PreparedGltfRuntime } from "./prepared-runtime";

type GltfReadyImagePublicationOwnerOptions = {
  readonly applyResourceChanges: (changes: ResourceArenaChanges) => void;
  readonly ibl: Pick<ImageBasedLightingRootFeature, "settleSpecularImage">;
  readonly materials: GltfMaterialPreparationArena;
  readonly ordinaryTextures: OrdinaryTextureResidencyController;
  readonly resourceArena: ResourceArena;
  readonly runtime: PreparedGltfRuntime;
};

/** Owns generation-safe prepared image identity and resource publication. */
export class GltfReadyImagePublicationOwner {
  readonly #options: GltfReadyImagePublicationOwnerOptions;

  constructor(options: GltfReadyImagePublicationOwnerOptions) {
    this.#options = options;
  }

  applyPending(): void {
    const outcomes = this.#options.runtime.images.pendingReadyOutcomes();
    if (outcomes.length === 0) return;
    for (const outcome of outcomes) {
      const state = this.#options.runtime.get(outcome.assetKey);
      if (
        state === undefined
        || state.status !== "ready"
        || state.instanceKey !== outcome.stateInstanceKey
      ) {
        outcome.acknowledge();
        continue;
      }
      if (!outcome.referencesRekeyed) {
        const rekeys: PreparedAssetOrdinaryTextureRekey[] = [];
        for (const binding of outcome.bindings) {
          if (binding.contentKey !== undefined || outcome.contentKey === undefined) continue;
          const previousTexture: TextureAssetUploadRef = {
            colorSpace: binding.colorSpace,
            kind: "asset",
            ...(binding.sampler === undefined ? {} : { sampler: binding.sampler }),
            uri: binding.textureUri,
          };
          const nextTexture: TextureAssetUploadRef = {
            ...previousTexture,
            contentKey: outcome.contentKey,
          };
          rekeys.push({
            next: {
              count: binding.count,
              key: textureCacheKey(nextTexture),
              texture: nextTexture,
            },
            previous: {
              count: binding.count,
              key: textureCacheKey(previousTexture),
              texture: previousTexture,
            },
          });
        }
        const changes = rekeyPreparedAssetOrdinaryTextures(
          this.#options.resourceArena,
          outcome.assetKey,
          rekeys,
        );
        // The arena mutation is the semantic commit. Checkpoint it before
        // fallible side effects so retry never reapplies the reference delta.
        outcome.markReferencesRekeyed();
        this.#options.applyResourceChanges(changes);
      }
      if (outcome.contentKey !== undefined) {
        for (const binding of outcome.bindings) {
          if (binding.contentKey !== undefined) continue;
          publishResourceArenaContentKey(
            this.#options.resourceArena,
            outcome.assetKey,
            binding.textureUri,
            outcome.contentKey,
          );
        }
      }
      for (const binding of outcome.bindings) {
        const contentKey = binding.contentKey ?? outcome.contentKey;
        const texture: TextureAssetUploadRef = {
          colorSpace: binding.colorSpace,
          ...(contentKey === undefined ? {} : { contentKey }),
          kind: "asset",
          ...(binding.sampler === undefined ? {} : { sampler: binding.sampler }),
          uri: binding.textureUri,
        };
        this.#options.ordinaryTextures.publishPrepared(texture, outcome.source);
      }
      if (outcome.iblSpecular !== undefined) {
        this.#options.ibl.settleSpecularImage(
          outcome.iblSpecular,
          outcome.key,
          outcome.source,
        );
      }
      this.#options.materials.invalidate(outcome.materials);
      outcome.acknowledge();
    }
  }
}
