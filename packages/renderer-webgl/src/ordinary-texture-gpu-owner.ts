import { FrameTextureResidencyIntent } from "./frame-texture-residency-intent";
import { OrdinaryTextureResidencyController } from "./ordinary-texture-residency-controller";
import { ResourceCapacityWakeOwner } from "./resource-capacity-wake-owner";
import { captureFirstFailure, type CapturedFailure } from "./captured-failure";
import {
  reserveResourceGovernor,
  type ResourceGovernor,
  type ResourceGovernorPolicy,
} from "./resource-governor";

type OrdinaryTextureGpuOwnerOptions = {
  readonly capacityWakes: ResourceCapacityWakeOwner;
  readonly contextGeneration: () => number;
  readonly frame: () => number;
  readonly invalidate: () => void;
  readonly maximumPersistentGpuBytes: number;
  readonly policy: ResourceGovernorPolicy;
  readonly residencyIntent: FrameTextureResidencyIntent;
  readonly resourceGovernor: ResourceGovernor;
  readonly textures: OrdinaryTextureResidencyController;
};

/** Owns ordinary-texture GPU suppression, admission, upload, and settlement. */
export class OrdinaryTextureGpuOwner {
  readonly #options: OrdinaryTextureGpuOwnerOptions;

  constructor(options: OrdinaryTextureGpuOwnerOptions) {
    this.#options = options;
  }

  finalizeResidencyIntent(commit: boolean): void {
    const suppressions = this.#options.residencyIntent.finishFrame(commit);
    if (suppressions.length === 0) return;
    const releaseWakeSuppression = this.#options.capacityWakes.suppressPersistentGpuWake();
    let capacityReleased = false;
    let firstFailure: CapturedFailure | undefined;
    try {
      for (const key of suppressions) {
        let report: ReturnType<OrdinaryTextureResidencyController["suppressGpuResidency"]> | undefined;
        firstFailure = captureFirstFailure(firstFailure, () => {
          report = this.#options.textures.suppressGpuResidency(key);
          capacityReleased ||= report.capacityReleased;
          if (report.operationFailure !== undefined) throw report.operationFailure.error;
        });
        const settledReport = report;
        if (settledReport !== undefined) firstFailure = captureFirstFailure(firstFailure, () => {
          const settlement = this.#options.textures.settleGpuReport(settledReport);
          if (settlement !== undefined) throw settlement.error;
        });
      }
    } finally {
      releaseWakeSuppression();
    }
    if (capacityReleased) this.#options.capacityWakes.wakePersistentGpuCapacity();
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  processUploads(): void {
    const releaseWakeSuppression = this.#options.capacityWakes.suppressPersistentGpuWake();
    let report!: ReturnType<OrdinaryTextureResidencyController["process"]>;
    let processFailure: CapturedFailure | undefined;
    try {
      report = this.#options.textures.process(
        this.#options.frame(),
        this.#options.contextGeneration(),
        {
          reserve: (cost) => {
            const persistentGpuMaximum = this.#options.maximumPersistentGpuBytes;
            if (cost.persistentGpuBytes > persistentGpuMaximum) {
              return {
                limit: persistentGpuMaximum,
                reason: "persistent-gpu-cost-exceeds-limit" as const,
              };
            }
            const uploadLimit = this.#options.policy.limits.uploadBytes;
            if (cost.uploadBytes > uploadLimit) {
              return { limit: uploadLimit, reason: "upload-cost-exceeds-limit" as const };
            }
            const reserved = reserveResourceGovernor(
              this.#options.resourceGovernor,
              "ordinary-texture",
              cost,
            );
            if (typeof reserved !== "string") {
              return {
                cancel: () => { reserved.cancel(); },
                commit: () => reserved.commit(),
              };
            }
            switch (reserved) {
              case "persistent-gpu-capacity":
              case "persistent-gpu-hard-limit":
              case "persistent-gpu-mandatory-floor":
              case "upload-capacity":
                return { reason: reserved };
              default:
                throw new Error(`Unexpected ordinary texture admission denial: ${reserved}`);
            }
          },
        },
      );
      processFailure = report.operationFailure === undefined
        ? undefined
        : { value: report.operationFailure.error };
    } finally {
      releaseWakeSuppression();
    }
    if (
      processFailure !== undefined
      && report.quarantinedBytesAfter === report.quarantinedBytesBefore
    ) this.#options.capacityWakes.wakePersistentGpuCapacity();
    const settlement = this.#options.textures.settleGpuReport(report);
    if (report.wakeRequested) this.#options.invalidate();
    if (processFailure !== undefined) throw processFailure.value;
    if (settlement !== undefined) throw settlement.error;
  }
}
