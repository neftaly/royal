import type { ImageBasedLightingRootFeature } from "../image-based-lighting-feature";
import { OrdinaryTextureResidencyController } from "../texture/ordinary-residency-controller";
import type { TextureAssetUploadRef } from "../webgl/materials";
import { GltfMaterialPreparationArena } from "./material-preparation-arena";
import { PreparedGltfRuntime } from "./prepared-runtime";

type GltfReadyImagePublicationOwnerOptions = {
  readonly ibl: Pick<ImageBasedLightingRootFeature, "settleSpecularImage">;
  readonly materials: GltfMaterialPreparationArena;
  readonly ordinaryTextures: OrdinaryTextureResidencyController;
  readonly runtime: PreparedGltfRuntime;
};

const imageTextureRef = (
  binding: Readonly<{
    colorSpace: NonNullable<TextureAssetUploadRef["colorSpace"]>;
    contentKey?: TextureAssetUploadRef["contentKey"];
    sampler?: TextureAssetUploadRef["sampler"];
    sourceUri?: string;
    textureUri: string;
  }>,
): TextureAssetUploadRef => ({
  colorSpace: binding.colorSpace,
  ...(binding.contentKey === undefined ? {} : { contentKey: binding.contentKey }),
  kind: "asset",
  ...(binding.sourceUri === undefined ? { preparedOnly: true } : {}),
  ...(binding.sourceUri === undefined ? {} : { releaseSourceAfterUpload: true }),
  ...(binding.sampler === undefined ? {} : { sampler: binding.sampler }),
  src: binding.sourceUri ?? binding.textureUri,
});

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
      for (const binding of outcome.bindings) {
        const texture = imageTextureRef(binding);
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
