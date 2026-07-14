import type { GltfInstancesNode, GltfNode } from "@royal/renderer-core";
import type { PreparedAssetArenaEvent } from "../resource-arena";
import {
  maximumResourceGovernorClassDurableBytes,
  replaceResourceGovernorLease,
  reserveResourceGovernor,
  RESOURCE_GOVERNOR_CLASSES,
  ResourceGovernorCpuCapacityError,
  type ResourceGovernor,
  type ResourceGovernorLease,
  type ResourceGovernorPolicy,
  type ResourceGovernorReservation,
} from "../resource-governor";
import type { SurfaceImageBasedLight, SurfaceLight } from "../webgl/lights";
import { gltfRequestKey } from "../frame-plan";
import type {
  GltfLoadMetrics,
  PreparedGltfAsset,
  LoadedGltfMaterial,
  LoadedGltfPrimitive,
} from "./prepared-asset";
import { preparedGltfAssetRetainedCpuBytes } from "./prepared-asset";
import {
  GltfImageDemandCoordinator,
  type GltfImageRecipeLease,
} from "./image-demand-coordinator";
import type { GltfPreparationCpuEstimate } from "./preparation-admission";
import { GltfSharedViewLodRegistry } from "./shared-view-lod-registry";
import {
  appendReadyGltfPacketOccurrence,
  clearGltfPacketOccurrence,
  createGltfPacketTopology,
  GLTF_PACKET_OCCURRENCE_STATUS,
  rebuildGltfPacketTopology,
  replaceReadyGltfPacketOccurrence,
  type GltfPacketOccurrence,
  type GltfPacketTopology,
} from "../gltf-packet-topology";
import {
  GltfPreparationScheduler,
  type GltfPreparationJobAdmitter,
} from "./preparation-scheduler";

export type AnyGltfNode = GltfNode | GltfInstancesNode;

export type PreparedGltfState = {
  hasMaterialLod: boolean;
  hasMaterialVariants: boolean;
  hasNodeLod: boolean;
  imageBasedLight?: SurfaceImageBasedLight;
  readonly instanceKey: number;
  readonly key: string;
  readonly preparedGeneration: number;
  readonly sourceUri: string;
  readonly sourceVersion?: number | string;
  error?: string;
  lights: readonly SurfaceLight[];
  load: GltfLoadMetrics;
  materials: readonly LoadedGltfMaterial[];
  nodeCount: number;
  primitives: readonly LoadedGltfPrimitive[];
  status: "loading" | "ready" | "error";
  variants: readonly string[];
};

export type PreparedGltfCpuAdmission = {
  assetDecode: ResourceGovernorLease | undefined;
  geometry: ResourceGovernorLease | undefined;
  transient: ResourceGovernorReservation | undefined;
};

export type PreparedGltfCpuOwnership = {
  readonly governor: ResourceGovernor;
  readonly policy: ResourceGovernorPolicy;
  readonly scheduleCapacityWake: () => void;
};

export type PreparedGltfStateObserver = (state: PreparedGltfState | undefined) => void;

/**
 * Owns prepared-asset identity, generation checks, preparation scheduling, and
 * the retryable arena-event publication queue. Packet and GPU arenas consume
 * these states but do not own their lifetime.
 */
export class PreparedGltfRuntime {
  readonly #events: PreparedAssetArenaEvent[] = [];
  #eventHead = 0;
  #eventDrainInProgress = false;
  #nextInstanceKey = 1;
  #cpuOwnership: PreparedGltfCpuOwnership | undefined;
  #cpuCapacityWakeSuppressed = false;
  readonly #cpuLeases = new Map<string, {
    assetDecode?: ResourceGovernorLease;
    geometry?: ResourceGovernorLease;
  }>();
  readonly #states = new Map<string, PreparedGltfState>();
  readonly #statesByNode = new WeakMap<AnyGltfNode, PreparedGltfState>();
  readonly #stateObservers = new Map<string, Set<PreparedGltfStateObserver>>();
  readonly #packetOccurrenceIndices = new Map<string, number[]>();
  readonly packetTopology: GltfPacketTopology = createGltfPacketTopology();
  readonly sharedViewLods = new GltfSharedViewLodRegistry();
  #images: GltfImageDemandCoordinator | undefined;
  readonly #reportObserverFailure: (failure: unknown) => void;
  readonly scheduler: GltfPreparationScheduler;

  constructor(
    limit = 2,
    admit?: GltfPreparationJobAdmitter,
    reportObserverFailure: (failure: unknown) => void = () => undefined,
  ) {
    this.#reportObserverFailure = reportObserverFailure;
    this.scheduler = new GltfPreparationScheduler(limit, admit);
  }

  get eventDrainInProgress(): boolean {
    return this.#eventDrainInProgress;
  }

  get cpuCapacityWakeSuppressed(): boolean {
    return this.#cpuCapacityWakeSuppressed;
  }

  configureCpuOwnership(ownership: PreparedGltfCpuOwnership): void {
    if (this.#cpuOwnership !== undefined) throw new Error("Prepared glTF CPU ownership is already configured");
    this.#cpuOwnership = ownership;
  }

  get states(): ReadonlyMap<string, PreparedGltfState> {
    return this.#states;
  }

  get images(): GltfImageDemandCoordinator {
    if (this.#images === undefined) throw new Error("Prepared glTF image coordination is not configured");
    return this.#images;
  }

  configureImages(images: GltfImageDemandCoordinator): void {
    if (this.#images !== undefined) throw new Error("Prepared glTF image coordination is already configured");
    this.#images = images;
  }

  disposeImages(): void {
    this.#images?.dispose();
  }

  wakeImages(): void {
    this.#images?.wake();
  }

  get(key: string): PreparedGltfState | undefined {
    return this.#states.get(key);
  }

  /** Observes one semantic asset identity without scanning renderer diagnostics. */
  observeState(key: string, observer: PreparedGltfStateObserver): () => void {
    const observers = this.#stateObservers.get(key) ?? new Set<PreparedGltfStateObserver>();
    observers.add(observer);
    this.#stateObservers.set(key, observers);
    const stop = (): void => {
      observers.delete(observer);
      if (observers.size === 0) this.#stateObservers.delete(key);
    };
    try {
      observer(this.#states.get(key));
    } catch (error) {
      stop();
      throw error;
    }
    return stop;
  }

  publishStateChange(key: string): void {
    const state = this.#states.get(key);
    const observers = this.#stateObservers.get(key);
    if (observers === undefined) return;
    let firstFailure: unknown;
    let failed = false;
    for (const observer of Array.from(observers)) {
      if (!observers.has(observer)) continue;
      try {
        observer(state);
      } catch (error) {
        if (!failed) firstFailure = error;
        failed = true;
      }
    }
    if (failed) this.#reportObserverFailure(firstFailure);
  }

  stateForNode(node: AnyGltfNode): PreparedGltfState {
    const nodeState = this.#statesByNode.get(node);
    if (nodeState !== undefined && this.#states.get(nodeState.key) === nodeState) return nodeState;
    const key = gltfRequestKey(node.asset.uri, node.asset.version);
    const state = this.#states.get(key);
    if (state === undefined) throw new Error(`retained glTF request ${key} has no semantic arena state`);
    this.#statesByNode.set(node, state);
    return state;
  }

  ensure(
    key: string,
    sourceUri: string,
    sourceVersion: number | string | undefined,
    preparedGeneration: number,
    startedAt: number,
  ): PreparedGltfState {
    const existing = this.#states.get(key);
    if (existing !== undefined) {
      if (existing.preparedGeneration !== preparedGeneration) {
        throw new Error(
          `retained glTF request ${key} generation ${preparedGeneration} conflicts with ${existing.preparedGeneration}`,
        );
      }
      return existing;
    }
    const state: PreparedGltfState = {
      hasMaterialLod: false,
      hasMaterialVariants: false,
      hasNodeLod: false,
      instanceKey: this.#nextInstanceKey,
      key,
      preparedGeneration,
      sourceUri,
      ...(sourceVersion === undefined ? {} : { sourceVersion }),
      lights: [],
      load: {
        imageFailures: 0,
        imageLoaded: 0,
        imageRequests: 0,
        startedAt,
      },
      materials: [],
      nodeCount: 0,
      primitives: [],
      status: "loading",
      variants: [],
    };
    this.#nextInstanceKey += 1;
    this.#states.set(key, state);
    this.publishStateChange(key);
    return state;
  }

  delete(key: string): boolean {
    const deleted = this.#states.delete(key);
    if (deleted) this.publishStateChange(key);
    return deleted;
  }

  rebuildPacketTopology(
    revision: number,
    requestKeys: readonly string[],
    occurrences: readonly GltfPacketOccurrence[],
  ): void {
    this.#packetOccurrenceIndices.clear();
    for (let index = 0; index < requestKeys.length; index += 1) {
      const key = requestKeys[index]!;
      const indices = this.#packetOccurrenceIndices.get(key);
      if (indices === undefined) this.#packetOccurrenceIndices.set(key, [index]);
      else indices.push(index);
    }
    rebuildGltfPacketTopology(this.packetTopology, revision, occurrences);
  }

  publishPacketError(key: string, revision: number): void {
    for (const occurrenceIndex of this.#packetOccurrenceIndices.get(key) ?? []) {
      if (this.packetTopology.occurrenceStatuses[occurrenceIndex] === GLTF_PACKET_OCCURRENCE_STATUS.ready) {
        clearGltfPacketOccurrence(this.packetTopology, revision, occurrenceIndex);
      }
    }
  }

  publishReadyPackets(
    key: string,
    revision: number | undefined,
    replacesReadyAsset: boolean,
    occurrence: (index: number) => GltfPacketOccurrence,
  ): void {
    const replacement = replacesReadyAsset ? this.sharedViewLods.beginAssetReplacement(key) : undefined;
    if (revision === undefined) {
      if (replacement !== undefined) this.sharedViewLods.commitAssetReplacement(replacement);
      return;
    }
    const indices = this.#packetOccurrenceIndices.get(key) ?? [];
    try {
      for (const occurrenceIndex of indices) {
        const status = this.packetTopology.occurrenceStatuses[occurrenceIndex];
        if (status === GLTF_PACKET_OCCURRENCE_STATUS.loading) {
          appendReadyGltfPacketOccurrence(this.packetTopology, revision, occurrence(occurrenceIndex));
        } else if (status === GLTF_PACKET_OCCURRENCE_STATUS.ready) {
          replaceReadyGltfPacketOccurrence(this.packetTopology, revision, occurrence(occurrenceIndex));
        }
      }
      if (replacement !== undefined) this.sharedViewLods.commitAssetReplacement(replacement);
    } catch (error) {
      for (const occurrenceIndex of indices) {
        if (this.packetTopology.occurrenceStatuses[occurrenceIndex] === GLTF_PACKET_OCCURRENCE_STATUS.ready) {
          clearGltfPacketOccurrence(this.packetTopology, revision, occurrenceIndex);
        }
      }
      if (replacement !== undefined) this.sharedViewLods.rollbackAssetReplacement(replacement);
      throw error;
    }
  }

  enqueueEvents(events: readonly PreparedAssetArenaEvent[]): void {
    this.#events.push(...events);
  }

  /** Keeps the failed event at the queue head so publication can be retried. */
  drainEvents(apply: (event: PreparedAssetArenaEvent) => void): void {
    if (this.#eventDrainInProgress) return;
    this.#eventDrainInProgress = true;
    try {
      while (this.#eventHead < this.#events.length) {
        apply(this.#events[this.#eventHead]!);
        this.#eventHead += 1;
      }
      this.#events.length = 0;
      this.#eventHead = 0;
    } finally {
      this.#eventDrainInProgress = false;
    }
  }

  clear(): void {
    this.#events.length = 0;
    this.#eventHead = 0;
    const retainedKeys = [...this.#states.keys()];
    this.#states.clear();
    for (const key of retainedKeys) this.publishStateChange(key);
  }

  dispose(): void {
    this.scheduler.dispose();
    this.disposeImages();
    for (const key of this.#cpuLeases.keys()) this.releaseCpuLeases(key);
    this.clear();
    this.#stateObservers.clear();
  }

  reserveCpuAdmission(assetKey: string, estimate: GltfPreparationCpuEstimate): PreparedGltfCpuAdmission {
    const ownership = this.#requireCpuOwnership();
    if (this.#cpuLeases.has(assetKey)) {
      throw new Error(`Prepared glTF asset ${assetKey} already owns CPU resource leases`);
    }
    const combinedMaximum = ownership.policy.limits.cpuDecodedBytes - RESOURCE_GOVERNOR_CLASSES
      .filter((resourceClass) => resourceClass !== "geometry" && resourceClass !== "asset-decode")
      .reduce((sum, resourceClass) =>
        sum + ownership.policy.classes[resourceClass].cpuDecodedBytes.mandatoryFloor, 0);
    if (estimate.geometry + estimate.assetDecode > combinedMaximum) {
      throw new ResourceGovernorCpuCapacityError(
        `glTF asset ${assetKey} declares up to ${estimate.geometry + estimate.assetDecode} prepared CPU bytes, exceeding its combined maximum ${combinedMaximum}`,
        true,
      );
    }
    if (estimate.transientPeak > ownership.policy.limits.transientPeakBytes) {
      throw new ResourceGovernorCpuCapacityError(
        `glTF asset ${assetKey} declares up to ${estimate.transientPeak} transient preparation bytes, exceeding the maximum ${ownership.policy.limits.transientPeakBytes}`,
        true,
      );
    }
    const admission: PreparedGltfCpuAdmission = {
      assetDecode: undefined,
      geometry: undefined,
      transient: undefined,
    };
    const reserveDurable = (
      resourceClass: "asset-decode" | "geometry",
      cpuDecodedBytes: number,
    ): void => {
      if (cpuDecodedBytes === 0) return;
      const reservation = reserveResourceGovernor(ownership.governor, resourceClass, { cpuDecodedBytes });
      if (typeof reservation === "string") {
        this.discardCpuAdmission(admission);
        throw new ResourceGovernorCpuCapacityError(
          `glTF asset ${assetKey} pre-decode CPU admission denied by root resource governor: ${reservation}`,
          cpuDecodedBytes > maximumResourceGovernorClassDurableBytes(
            ownership.policy,
            resourceClass,
            "cpuDecodedBytes",
          ),
        );
      }
      admission[resourceClass === "asset-decode" ? "assetDecode" : "geometry"] = reservation.commit();
    };
    try {
      reserveDurable("geometry", estimate.geometry);
      reserveDurable("asset-decode", estimate.assetDecode);
      if (estimate.transientPeak > 0) {
        const transient = reserveResourceGovernor(ownership.governor, "asset-decode", {
          transientPeakBytes: estimate.transientPeak,
        });
        if (typeof transient === "string") {
          throw new ResourceGovernorCpuCapacityError(
            `glTF asset ${assetKey} transient preparation admission denied by root resource governor: ${transient}`,
            false,
          );
        }
        admission.transient = transient;
      }
      return admission;
    } catch (error) {
      this.discardCpuAdmission(admission);
      throw error;
    }
  }

  finalizeCpuAdmission(
    assetKey: string,
    estimate: GltfPreparationCpuEstimate,
    asset: PreparedGltfAsset,
    admission: PreparedGltfCpuAdmission,
  ): void {
    const ownership = this.#requireCpuOwnership();
    const actual = preparedGltfAssetRetainedCpuBytes(asset);
    if (actual.assetDecode > estimate.assetDecode || actual.geometry > estimate.geometry) {
      throw new ResourceGovernorCpuCapacityError(
        `glTF asset ${assetKey} prepared bytes exceeded its pre-decode estimate `
        + `(asset-decode ${actual.assetDecode}/${estimate.assetDecode}, geometry ${actual.geometry}/${estimate.geometry})`,
        true,
      );
    }
    let capacityReleased = false;
    const resize = (
      resourceClass: "asset-decode" | "geometry",
      lease: ResourceGovernorLease | undefined,
      cpuDecodedBytes: number,
    ): ResourceGovernorLease | undefined => {
      if (lease === undefined) {
        if (cpuDecodedBytes !== 0) throw new Error(`glTF ${resourceClass} estimate omitted ${cpuDecodedBytes} retained bytes`);
        return undefined;
      }
      if (cpuDecodedBytes === 0) {
        lease.release();
        capacityReleased = true;
        return undefined;
      }
      const replacement = replaceResourceGovernorLease(ownership.governor, lease, { cpuDecodedBytes });
      if (typeof replacement === "string") throw new Error(`glTF ${resourceClass} estimate shrink was denied: ${replacement}`);
      const resized = replacement.commit();
      if (cpuDecodedBytes < estimate[resourceClass === "asset-decode" ? "assetDecode" : "geometry"]) {
        capacityReleased = true;
      }
      return resized;
    };
    const previouslySuppressed = this.#cpuCapacityWakeSuppressed;
    this.#cpuCapacityWakeSuppressed = true;
    try {
      admission.geometry = resize("geometry", admission.geometry, actual.geometry);
      admission.assetDecode = resize("asset-decode", admission.assetDecode, actual.assetDecode);
      admission.transient?.cancel();
      admission.transient = undefined;
    } finally {
      this.#cpuCapacityWakeSuppressed = previouslySuppressed;
      if (capacityReleased && !previouslySuppressed) ownership.scheduleCapacityWake();
    }
    this.#cpuLeases.set(assetKey, {
      ...(admission.assetDecode === undefined ? {} : { assetDecode: admission.assetDecode }),
      ...(admission.geometry === undefined ? {} : { geometry: admission.geometry }),
    });
  }

  discardCpuAdmission(admission: PreparedGltfCpuAdmission): void {
    const previouslySuppressed = this.#cpuCapacityWakeSuppressed;
    this.#cpuCapacityWakeSuppressed = true;
    try {
      admission.transient?.cancel();
      admission.transient = undefined;
      admission.assetDecode?.release();
      admission.assetDecode = undefined;
      admission.geometry?.release();
      admission.geometry = undefined;
    } finally {
      this.#cpuCapacityWakeSuppressed = previouslySuppressed;
    }
  }

  releaseCpuLeases(assetKey: string): void {
    const leases = this.#cpuLeases.get(assetKey);
    if (leases === undefined) return;
    leases.assetDecode?.release();
    leases.geometry?.release();
    this.#cpuLeases.delete(assetKey);
  }

  releaseDecodeLease(assetKey: string): void {
    const leases = this.#cpuLeases.get(assetKey);
    leases?.assetDecode?.release();
    if (leases !== undefined) delete leases.assetDecode;
  }

  takeDecodeRecipeLease(assetKey: string, initialBytes: number): GltfImageRecipeLease {
    const ownership = this.#requireCpuOwnership();
    const leases = this.#cpuLeases.get(assetKey);
    let lease = leases?.assetDecode;
    if (leases !== undefined) delete leases.assetDecode;
    let released = false;
    let retainedBytes = initialBytes;
    if (lease === undefined && initialBytes !== 0) {
      throw new Error(`Prepared glTF asset ${assetKey} has ${initialBytes} recipe bytes without a CPU lease`);
    }
    return {
      release: () => {
        if (released) return;
        lease?.release();
        lease = undefined;
        retainedBytes = 0;
        released = true;
      },
      resize: (nextBytes) => {
        if (!Number.isSafeInteger(nextBytes) || nextBytes < 0) {
          throw new RangeError(`glTF image recipe bytes must be a non-negative safe integer, received ${nextBytes}`);
        }
        if (released) throw new Error(`glTF image recipe lease for ${assetKey} is released`);
        if (nextBytes > retainedBytes) {
          throw new Error(`glTF image recipe lease for ${assetKey} cannot grow from ${retainedBytes} to ${nextBytes} bytes`);
        }
        if (nextBytes === retainedBytes) return;
        if (nextBytes === 0) {
          lease?.release();
          lease = undefined;
          retainedBytes = 0;
          return;
        }
        if (lease === undefined) throw new Error(`glTF image recipe lease for ${assetKey} has no ownership to resize`);
        const replacement = replaceResourceGovernorLease(ownership.governor, lease, { cpuDecodedBytes: nextBytes });
        if (typeof replacement === "string") {
          throw new Error(`glTF image recipe lease shrink for ${assetKey} was denied: ${replacement}`);
        }
        try {
          lease = replacement.commit();
          retainedBytes = nextBytes;
        } catch (error) {
          replacement.cancel();
          throw error;
        }
      },
    };
  }

  #requireCpuOwnership(): PreparedGltfCpuOwnership {
    if (this.#cpuOwnership === undefined) throw new Error("Prepared glTF CPU ownership is not configured");
    return this.#cpuOwnership;
  }
}
