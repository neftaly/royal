import {
  reserveResourceGovernor,
  type ResourceGovernor,
  type ResourceGovernorReservation,
} from "../resource-governor";
import type { WebGlContextCapabilities } from "../context/capability-owner";
import type { WebGlContextLifecycle } from "../root-types";
import { captureFailure, captureFirstFailure, type CapturedFailure } from "../captured-failure";
import type { VirtualTextureRuntimeState } from "./runtime";
import { VirtualTextureRuntimeShell } from "./runtime-shell";
import {
  maximumVirtualTexturePageTableUploadBytes,
  selectColdVirtualTextureAllocation,
} from "./allocation-policy";
import {
  virtualTextureStoredPageBytes,
  type VirtualTextureManifestModel,
} from "./model";
import {
  admitVirtualTextureGpuResource,
  consumeVirtualTextureGpuWake,
  releaseVirtualTextureGpuAllocation,
  releaseVirtualTextureGpuResource,
  virtualTextureGpuAdmission,
  virtualTextureGpuArenaSnapshot,
  virtualTextureGpuResource,
  virtualTextureGpuResourceSnapshot,
  type VirtualTextureGpuArena,
} from "./gpu-arena";

type VirtualTextureGpuAdmissionOwnerOptions = {
  readonly capabilities: () => WebGlContextCapabilities;
  readonly consumeGpuOutcomes: () => void;
  readonly contextGeneration: () => number;
  readonly contextLifecycle: () => WebGlContextLifecycle;
  readonly frame: () => number;
  readonly gpu: VirtualTextureGpuArena;
  readonly invalidate: () => void;
  readonly maximumPersistentGpuBytes: number;
  readonly maximumUploadBytes: number;
  readonly resourceGovernor: ResourceGovernor;
  readonly runtime: VirtualTextureRuntimeShell;
  readonly suppressPersistentGpuWake: () => () => void;
  readonly wakePersistentGpuCapacity: () => void;
};

/** Owns VT allocation policy, root-governor leases, cold reclamation, and release. */
export class VirtualTextureGpuAdmissionOwner {
  readonly #options: VirtualTextureGpuAdmissionOwnerOptions;
  #allocationRetryFrame = -1;

  constructor(options: VirtualTextureGpuAdmissionOwnerOptions) {
    this.#options = options;
  }

  ensure(
    state: VirtualTextureRuntimeState,
    manifest: VirtualTextureManifestModel,
    demandedStates: ReadonlySet<VirtualTextureRuntimeState>,
  ): boolean {
    const firstAttempt = this.#attempt(state, manifest);
    if (firstAttempt !== "pressure") return firstAttempt === "ready";
    const reclamation = this.#oldestColdAllocation(demandedStates);
    if (reclamation.state === undefined) {
      if (reclamation.graceBlocked) this.#scheduleAllocationRetry();
      return false;
    }
    this.release(reclamation.state, false);
    const secondAttempt = this.#attempt(state, manifest);
    if (secondAttempt === "pressure") {
      const remaining = this.#oldestColdAllocation(demandedStates);
      if (remaining.state !== undefined || remaining.graceBlocked) {
        this.#scheduleAllocationRetry();
      }
    }
    return secondAttempt === "ready";
  }

  release(state: VirtualTextureRuntimeState, removeResource: boolean): void {
    let releaseFailure: CapturedFailure | undefined;
    let release: ReturnType<typeof releaseVirtualTextureGpuResource> = {
      releaseError: undefined,
      releaseErrorPresent: false,
    };
    const hadLease = this.#options.runtime.hasGpuLease(state.key);
    const releaseWakeSuppression = this.#options.suppressPersistentGpuWake();
    try {
      releaseFailure = captureFirstFailure(releaseFailure, () => {
        release = removeResource
          ? releaseVirtualTextureGpuResource(this.#options.gpu, state.key)
          : releaseVirtualTextureGpuAllocation(this.#options.gpu, state.key);
      });
      if (releaseFailure !== undefined || release.releaseErrorPresent) {
        this.#options.runtime.quarantineGpuLease(state.key);
      } else {
        releaseFailure = captureFirstFailure(
          releaseFailure,
          () => this.#options.runtime.releaseGpuLease(state.key),
        );
      }
    } finally {
      releaseWakeSuppression();
    }
    releaseFailure = captureFirstFailure(releaseFailure, this.#options.consumeGpuOutcomes);
    if (release.releaseErrorPresent) {
      releaseFailure ??= { value: release.releaseError };
    } else if (hadLease) this.#options.wakePersistentGpuCapacity();
    if (this.#options.contextLifecycle() === "active") {
      if (consumeVirtualTextureGpuWake(this.#options.gpu)) this.#options.invalidate();
    }
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  #attempt(
    state: VirtualTextureRuntimeState,
    manifest: VirtualTextureManifestModel,
  ): "pressure" | "ready" | "terminal" {
    if (this.#options.contextLifecycle() !== "active") return "pressure";
    const admissionOptions = {
      ...(state.texture.sampler?.magFilter === undefined
        ? {}
        : { atlasMagFilter: state.texture.sampler.magFilter }),
      ...(state.texture.sampler?.minFilter === undefined
        ? {}
        : { atlasMinFilter: state.texture.sampler.minFilter }),
      colorSpace: state.texture.colorSpace ?? manifest.colorSpace ?? "srgb",
      manifest,
      sourceGeneration: state.sourceGeneration,
    } as const;
    let governorReservation: ResourceGovernorReservation | undefined;
    if (!this.#options.runtime.hasGpuLease(state.key)) {
      const gpuArena = virtualTextureGpuArenaSnapshot(this.#options.gpu);
      const capabilities = this.#options.capabilities();
      const admission = virtualTextureGpuAdmission(
        admissionOptions,
        capabilities.maxTextureSize,
        gpuArena.budgetBytes - gpuArena.chargedBytes,
        capabilities.maxTextureImageUnits,
      );
      const persistentGpuMaximum = this.#options.maximumPersistentGpuBytes;
      if (admission.kind === "dormant" && admission.requiredBytes > persistentGpuMaximum) {
        state.stats.gpuAdmissionFailures += 1;
        this.#options.runtime.markUnsupported(
          state,
          `resource allocation requires ${admission.requiredBytes} persistent GPU bytes, exceeding the virtual-texture limit ${persistentGpuMaximum}`,
        );
        return "terminal";
      }
      if (
        admission.kind === "dormant"
        && manifest.physicalByteBudget !== undefined
        && admission.requiredBytes > manifest.physicalByteBudget
      ) {
        state.stats.gpuAdmissionFailures += 1;
        this.#options.runtime.markUnsupported(
          state,
          `resource allocation requires ${admission.requiredBytes} persistent GPU bytes, exceeding the manifest physical byte limit ${manifest.physicalByteBudget}`,
        );
        return "terminal";
      }
      if (admission.kind === "dormant") {
        state.stats.gpuAdmissionFailures += 1;
        return "pressure";
      }
      if (admission.kind === "supported") {
        if (admission.allocatedBytes > persistentGpuMaximum) {
          state.stats.gpuAdmissionFailures += 1;
          this.#options.runtime.markUnsupported(
            state,
            `resource allocation requires ${admission.allocatedBytes} persistent GPU bytes, exceeding the virtual-texture limit ${persistentGpuMaximum}`,
          );
          return "terminal";
        }
        const largestUploadBytes = Math.max(
          virtualTextureStoredPageBytes(manifest),
          maximumVirtualTexturePageTableUploadBytes(
            manifest,
          ),
        );
        if (largestUploadBytes > this.#options.maximumUploadBytes) {
          state.stats.gpuAdmissionFailures += 1;
          this.#options.runtime.markUnsupported(
            state,
            `page or page-table upload requires up to ${largestUploadBytes} bytes, exceeding the configured per-frame upload limit ${this.#options.maximumUploadBytes}`,
          );
          return "terminal";
        }
        const reserved = reserveResourceGovernor(this.#options.resourceGovernor, "virtual-texture", {
          persistentGpuBytes: admission.allocatedBytes,
        });
        if (typeof reserved === "string") {
          state.stats.gpuAdmissionFailures += 1;
          this.#options.runtime.diagnose(
            state,
            `Virtual texture ${state.activeSource.manifestUri} deferred by root resource governor: ${reserved}`,
            `virtual-texture-governor:${state.activeSource.manifestUri}:${reserved}`,
          );
          return "pressure";
        }
        governorReservation = reserved;
      }
    }
    let result: ReturnType<typeof admitVirtualTextureGpuResource> | undefined;
    let admissionFailure: CapturedFailure | undefined;
    let reservationCancelled = false;
    const quarantineBeforeAdmission = virtualTextureGpuArenaSnapshot(this.#options.gpu).quarantinedBytes;
    const releaseWakeSuppression = this.#options.suppressPersistentGpuWake();
    try {
      try {
        result = admitVirtualTextureGpuResource(
          this.#options.gpu,
          state.key,
          this.#options.contextGeneration(),
          admissionOptions,
        );
      } catch (value) {
        admissionFailure = { value };
      }
      if (governorReservation !== undefined) {
        const quarantineAfterAdmission = virtualTextureGpuArenaSnapshot(
          this.#options.gpu,
        ).quarantinedBytes;
        const settlementFailure = captureFailure(() => {
          if (quarantineAfterAdmission > quarantineBeforeAdmission) {
            this.#options.runtime.commitQuarantinedGpuLease(governorReservation!);
          } else if (result?.kind === "ready") {
            this.#options.runtime.commitGpuLease(state.key, governorReservation!);
          } else {
            reservationCancelled = governorReservation!.cancel();
          }
        });
        admissionFailure ??= settlementFailure;
        governorReservation = undefined;
      }
    } finally {
      releaseWakeSuppression();
    }
    if (reservationCancelled) this.#options.wakePersistentGpuCapacity();
    if (admissionFailure !== undefined) throw admissionFailure.value;
    if (result === undefined) throw new Error("Virtual texture GPU admission did not produce a result");
    if (result.kind === "unsupported") {
      const reason = result.reason === "insufficient-texture-units"
        ? "requires at least two fragment texture units for atlas and page-table textures"
        : result.reason === "texture-size-exceeded"
          ? "atlas or page-table dimensions exceed WebGL2 texture limits"
          : result.reason;
      this.#options.runtime.markUnsupported(state, reason);
      return "terminal";
    }
    if (result.kind === "failed") {
      state.status = "error";
      state.stats.gpuAdmissionFailures += 1;
      const reason = result.error instanceof Error ? result.error.message : String(result.error);
      this.#options.runtime.diagnose(
        state,
        `Virtual texture ${state.activeSource.manifestUri} GPU resource admission failed: ${reason}`,
        `virtual-texture-gpu-admission:${state.activeSource.manifestUri}`,
      );
      return "terminal";
    }
    if (result.kind === "dormant") return "pressure";
    if (consumeVirtualTextureGpuWake(this.#options.gpu)) this.#options.invalidate();
    return "ready";
  }

  #oldestColdAllocation(
    demandedStates: ReadonlySet<VirtualTextureRuntimeState>,
  ): { readonly graceBlocked: boolean; readonly state?: VirtualTextureRuntimeState } {
    const candidates = [...this.#options.runtime.resources.values()].map((candidate) => {
      const resource = virtualTextureGpuResource(this.#options.gpu, candidate.key);
      return {
        admissionTicket: candidate.admissionTicket,
        allocated: resource !== undefined && virtualTextureGpuResourceSnapshot(resource).allocated,
        demanded: demandedStates.has(candidate),
        lastDemandFrame: candidate.lastDemandFrame,
        state: candidate,
      };
    });
    return selectColdVirtualTextureAllocation(candidates, this.#options.frame());
  }

  #scheduleAllocationRetry(): void {
    const frame = this.#options.frame();
    if (this.#allocationRetryFrame === frame) return;
    this.#allocationRetryFrame = frame;
    this.#options.invalidate();
  }
}
