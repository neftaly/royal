import type { OrdinaryTextureResidencyController } from "./ordinary-texture-residency-controller";
import type { ResourceCapacityWakeOwner } from "./resource-capacity-wake-owner";
import type { VirtualTextureGpuAdmissionOwner } from "./virtual-texture-gpu-admission-owner";
import type { VirtualTextureRuntimeState } from "./virtual-texture-runtime";
import type { VirtualTextureRuntimeShell } from "./virtual-texture-runtime-shell";

type CapturedFailure = { readonly value: unknown };

const captureFailure = (action: () => void): CapturedFailure | undefined => {
  try {
    action();
    return undefined;
  } catch (value) {
    return { value };
  }
};

const captureFirstFailure = (
  firstFailure: CapturedFailure | undefined,
  action: () => void,
): CapturedFailure | undefined => {
  const nextFailure = captureFailure(action);
  return firstFailure ?? nextFailure;
};

type RootResourceReleaseOwnerOptions = {
  readonly capacityWakes: ResourceCapacityWakeOwner;
  readonly ordinaryTextures: OrdinaryTextureResidencyController;
  readonly virtualTextureAdmission: VirtualTextureGpuAdmissionOwner;
  readonly virtualTextureRuntime: VirtualTextureRuntimeShell;
};

/** Owns fallible ordinary/virtual texture release ordering and wake settlement. */
export class RootResourceReleaseOwner {
  readonly #options: RootResourceReleaseOwnerOptions;

  constructor(options: RootResourceReleaseOwnerOptions) {
    this.#options = options;
  }

  releaseOrdinaryTexture(key: string): void {
    let releaseFailure = captureFailure(() => this.#releaseAutomaticVirtualTextures(key));
    this.#options.virtualTextureRuntime.releaseAutoMetadata(key);
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
    const state = this.#options.virtualTextureRuntime.get(key);
    if (state !== undefined) this.releaseVirtualTextureState(state);
  }

  releaseVirtualTextureState(state: VirtualTextureRuntimeState): void {
    let releaseFailure = captureFailure(() => this.#options.virtualTextureRuntime.forget(state));
    releaseFailure = captureFirstFailure(
      releaseFailure,
      () => this.#options.virtualTextureAdmission.release(state, true),
    );
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  #releaseAutomaticVirtualTextures(textureKey: string): void {
    const prefix = `auto-base-color:${textureKey}:`;
    let releaseFailure: CapturedFailure | undefined;
    for (const [key, state] of this.#options.virtualTextureRuntime.resources) {
      if (!key.startsWith(prefix)) continue;
      releaseFailure = captureFirstFailure(releaseFailure, () => this.releaseVirtualTextureState(state));
    }
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }
}
