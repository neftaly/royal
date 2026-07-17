import type { ImageBasedLightingRootFeature } from "../image-based-lighting-feature";
import { OrdinaryTextureResidencyController } from "../texture/ordinary-residency-controller";
import { GltfMaterialPreparationArena } from "./material-preparation-arena";
import { PreparedGltfRuntime } from "./prepared-runtime";
import { gltfImageTextureRef } from "./image-texture-ref";

type GltfReadyImagePublicationOwnerOptions = {
  readonly ibl: Pick<ImageBasedLightingRootFeature, "settleSpecularImage">;
  readonly materials: GltfMaterialPreparationArena;
  readonly ordinaryTextures: OrdinaryTextureResidencyController;
  readonly runtime: PreparedGltfRuntime;
};

/** Owns generation-safe prepared image identity and resource publication. */
export class GltfReadyImagePublicationOwner {
  readonly #options: GltfReadyImagePublicationOwnerOptions;

  constructor(options: GltfReadyImagePublicationOwnerOptions) {
    this.#options = options;
  }

  applyPending(): void {
    this.#options.runtime.images.acknowledgePublicationFrame();
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
        const texture = gltfImageTextureRef(binding);
        this.#options.ordinaryTextures.publishPreparedBeforeUploadPass(texture, outcome.source);
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
