import type { OrdinaryTextureResidencyController } from "./texture/ordinary-residency-controller";
import type { ResourceCapacityWakeOwner } from "./resource-capacity-wake-owner";
import type { VirtualTextureFeature } from "./virtual-texture/feature";
import { captureFailure, captureFirstFailure } from "./captured-failure";

type RootResourceReleaseOwnerOptions = {
  readonly capacityWakes: ResourceCapacityWakeOwner;
  readonly ordinaryTextures: OrdinaryTextureResidencyController;
  readonly virtualTextures: VirtualTextureFeature;
};

/** Owns fallible ordinary/virtual texture release ordering and wake settlement. */
export class RootResourceReleaseOwner {
  readonly #options: RootResourceReleaseOwnerOptions;

  constructor(options: RootResourceReleaseOwnerOptions) {
    this.#options = options;
  }

  releaseOrdinaryTexture(key: string): void {
    let releaseFailure = captureFailure(() => this.#releaseAutomaticVirtualTextures(key));
    this.#options.virtualTextures.releaseAutoMetadata(key);
    const releaseWakeSuppression = this.#options.capacityWakes.suppressPersistentGpuWake();
    let report: ReturnType<OrdinaryTextureResidencyController["release"]> | undefined;
    try {
      report = this.#options.ordinaryTextures.release(key);
      if (report.operationFailure !== undefined) {
        releaseFailure ??= { value: report.operationFailure.error };
      }
    } finally {
      releaseWakeSuppression();
    }
    if (report?.capacityReleased === true) this.#options.capacityWakes.wakePersistentGpuCapacity();
    if (report !== undefined) releaseFailure = captureFirstFailure(releaseFailure, () => {
      const settlement = this.#options.ordinaryTextures.settleGpuReport(report);
      if (settlement !== undefined) throw settlement.error;
    });
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  releaseVirtualTexture(key: string): void {
    this.#options.virtualTextures.releaseKey(key);
  }

  #releaseAutomaticVirtualTextures(textureKey: string): void {
    this.#options.virtualTextures.releaseAutomaticTexture(textureKey);
  }
}
