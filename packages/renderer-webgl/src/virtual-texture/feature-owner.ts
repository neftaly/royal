import type { Material, VirtualTextureAssetRef } from "@royal/renderer-core";
import { loadHtmlImage } from "../texture/browser-image-loader";
import { captureFailure, captureFirstFailure, type CapturedFailure } from "../captured-failure";
import type { DecodedTextureSourceLifetime } from "../texture/decoded-source-lifetime";
import type { CpuGeometry } from "../geometry-recipes";
import type { Mat4 } from "../math/mat4";
import {
  reserveResourceGovernor,
  type ResourceGovernor,
} from "../resource-governor";
import type { WebGlVirtualTexturingSnapshot } from "../root-types";
import { virtualTextureDiagnosticsSnapshot } from "./diagnostics";
import { VirtualTextureDemandOwner } from "./demand-owner";
import { VirtualTextureGpuAdmissionOwner } from "./gpu-admission-owner";
import type {
  BaseColorTextureResidency,
  VirtualTextureDrawDemandContext,
  VirtualTextureDrawDemandModelSource,
  VirtualTextureRuntimeState,
  ViewportSize,
} from "./runtime";
import {
  VirtualTextureRuntimeShell,
  type VirtualTextureAssetSnapshot,
} from "./runtime-shell";
import {
  bindVirtualTextureGpuResource,
  clearVirtualTextureGpuOutcomes,
  consumeVirtualTextureGpuWake,
  createVirtualTextureGpuArena,
  dropVirtualTextureGpuContext,
  processVirtualTextureGpuUploads,
  virtualTextureGpuHasActionableUploads,
  virtualTextureGpuDrawable,
  virtualTextureGpuOutcome,
  virtualTextureGpuOutcomeCount,
  type VirtualTextureGpuArena,
  type VirtualTextureGpuBinding,
} from "./gpu-arena";
import type { VertexInputGeometry } from "../vertex-input/arena";
import type { VirtualTextureFeature, VirtualTextureFeatureOptions } from "./feature";
import type { WebGlTextureBindingShell } from "../webgl/texture-binding-shell";

/** Owns the complete virtual-texture runtime and its renderer-facing lifecycle. */
export class VirtualTextureFeatureOwner implements VirtualTextureFeature {
  readonly #admission: VirtualTextureGpuAdmissionOwner;
  readonly #decodedSources: DecodedTextureSourceLifetime;
  readonly #demand: VirtualTextureDemandOwner;
  readonly #frame: () => number;
  readonly #gpu: VirtualTextureGpuArena;
  readonly #invalidate: () => void;
  readonly #resourceGovernor: ResourceGovernor;
  readonly #runtime: VirtualTextureRuntimeShell;

  constructor(options: VirtualTextureFeatureOptions) {
    this.#decodedSources = options.decodedSources;
    this.#frame = options.frame;
    this.#invalidate = options.invalidate;
    this.#resourceGovernor = options.resourceGovernor;
    this.#gpu = createVirtualTextureGpuArena(options.gl, options.textureHandles, {
      maxPhysicalBytes: options.maximumPersistentGpuBytes,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    this.#runtime = new VirtualTextureRuntimeShell({
      active: options.active,
      admitJob: options.admitJob,
      decodedSources: options.decodedSources,
      diagnostic: options.diagnostic,
      disposed: options.disposed,
      frame: options.frame,
      automaticVirtualTextures: options.automaticVirtualTextures,
      gpu: this.#gpu,
      invalidate: options.invalidate,
      loadImageSource: (uri, signal) => loadHtmlImage(uri, { signal }),
      maximumDecodedCpuBytes: options.maximumDecodedCpuBytes,
      ...(options.now === undefined ? {} : { now: options.now }),
      resourceGovernor: options.resourceGovernor,
    });
    this.#admission = new VirtualTextureGpuAdmissionOwner({
      capabilities: options.capabilities,
      consumeGpuOutcomes: () => this.#consumeGpuOutcomes(),
      contextGeneration: options.contextGeneration,
      contextLifecycle: options.contextLifecycle,
      frame: options.frame,
      gpu: this.#gpu,
      invalidate: options.invalidate,
      maximumPersistentGpuBytes: options.maximumPersistentGpuBytes,
      maximumUploadBytes: options.maximumUploadBytes,
      resourceGovernor: options.resourceGovernor,
      runtime: this.#runtime,
      suppressPersistentGpuWake: () => options.capacityWakes.suppressPersistentGpuWake(),
      wakePersistentGpuCapacity: () => options.capacityWakes.wakePersistentGpuCapacity(),
    });
    this.#demand = new VirtualTextureDemandOwner({
      consumeGpuOutcomes: () => this.#consumeGpuOutcomes(),
      ensureGpuResource: (state, manifest, demandedStates) => (
        this.#admission.ensure(state, manifest, demandedStates)
      ),
      frame: options.frame,
      gpu: this.#gpu,
      recordUnsupported: options.recordUnsupported,
      runtime: this.#runtime,
    });
  }

  get resources(): ReadonlyMap<string, VirtualTextureRuntimeState> {
    return this.#runtime.resources;
  }

  assetSnapshot(texture: VirtualTextureAssetRef): VirtualTextureAssetSnapshot | undefined {
    return this.#runtime.assetSnapshot(texture);
  }

  beginFrame(): void {
    this.#runtime.beginFrame();
  }

  bindGpuResource(
    bindings: WebGlTextureBindingShell,
    key: string,
    atlasTextureUnit: number,
    pageTableTextureUnit: number,
  ): VirtualTextureGpuBinding | undefined {
    return bindVirtualTextureGpuResource(
      this.#gpu,
      key,
      atlasTextureUnit,
      pageTableTextureUnit,
      bindings,
    );
  }

  beginView(viewIndex: number): void {
    this.#runtime.beginView(viewIndex);
  }

  clear(): void {
    this.#demand.clear();
    this.#runtime.clearAutoMetadata();
  }

  drainRequests(): void {
    this.#runtime.requests.drain();
  }

  drawDemandContext(
    geometryId: number,
    geometry: CpuGeometry,
    material: Material,
    modelSource: VirtualTextureDrawDemandModelSource,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
  ): VirtualTextureDrawDemandContext | undefined {
    return this.#demand.drawDemandContext(
      geometryId,
      geometry,
      material,
      modelSource,
      projection,
      view,
      viewportSize,
    );
  }

  finishFrame(commit: boolean): void {
    this.#demand.finishFrame(commit);
  }

  hasActionableUploads(): boolean {
    return virtualTextureGpuHasActionableUploads(this.#gpu);
  }

  isGpuDrawable(key: string): boolean {
    return virtualTextureGpuDrawable(this.#gpu, key);
  }

  loseContext(): void {
    this.#runtime.loseContext();
  }

  prepareFrame(_authoredVirtualTextures: boolean): void {}

  processGpuUploads(): void {
    const gpuFailure = captureFailure(() => {
      processVirtualTextureGpuUploads(this.#gpu, this.#frame(), {
        reserve: (uploadBytes) => {
          const reserved = reserveResourceGovernor(this.#resourceGovernor, "virtual-texture", {
            uploadBytes,
          });
          if (typeof reserved === "string") return undefined;
          return {
            cancel: () => { reserved.cancel(); },
            commit: () => { reserved.commit().release(); },
          };
        },
      });
    });
    const closeFailure = captureFailure(() => this.#consumeGpuOutcomes());
    if (consumeVirtualTextureGpuWake(this.#gpu)) this.#invalidate();
    if (gpuFailure !== undefined) throw gpuFailure.value;
    if (closeFailure !== undefined) throw closeFailure.value;
  }

  registerAutoDecodedSource(texture: Parameters<VirtualTextureRuntimeShell["registerAutoDecodedSource"]>[0], source: Parameters<VirtualTextureRuntimeShell["registerAutoDecodedSource"]>[1]): void {
    this.#runtime.registerAutoDecodedSource(texture, source);
  }

  releaseAllGpuLeases(): void {
    this.#runtime.releaseAllGpuLeases();
  }

  releaseAutomaticTexture(textureKey: string): void {
    const prefix = `auto-base-color:${textureKey}:`;
    let releaseFailure: CapturedFailure | undefined;
    for (const [key, state] of this.#runtime.resources) {
      if (!key.startsWith(prefix)) continue;
      releaseFailure = captureFirstFailure(releaseFailure, () => this.releaseState(state));
    }
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  releaseAutoMetadata(textureKey: string): void {
    this.#runtime.releaseAutoMetadata(textureKey);
  }

  releaseGeometry(geometryId: number): void {
    this.#demand.releaseGeometry(geometryId);
  }

  releaseKey(key: string): void {
    const state = this.#runtime.get(key);
    if (state !== undefined) this.releaseState(state);
  }

  releaseState(state: VirtualTextureRuntimeState): void {
    let releaseFailure = captureFailure(() => this.#runtime.forget(state));
    releaseFailure = captureFirstFailure(
      releaseFailure,
      () => this.#admission.release(state, true),
    );
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  resolveBaseColorResidency(
    geometry: VertexInputGeometry,
    material: Material,
    demandContext: VirtualTextureDrawDemandContext | undefined,
  ): BaseColorTextureResidency {
    return this.#demand.resolveBaseColorResidency(geometry, material, demandContext);
  }

  scheduleGovernedAdmissionRetry(): void {
    this.#runtime.scheduleGovernedAdmissionRetry();
  }

  snapshot(unsupportedDraws: number): WebGlVirtualTexturingSnapshot {
    return virtualTextureDiagnosticsSnapshot(this.#runtime, this.#gpu, unsupportedDraws);
  }

  wakeDecodedCapacity(): boolean {
    return this.#runtime.requests.wakeDecodedCapacity();
  }

  dropGpuContext(): void {
    dropVirtualTextureGpuContext(this.#gpu);
  }

  #consumeGpuOutcomes(): void {
    let firstFailure = captureFailure(() => this.#decodedSources.retryPendingVirtualTexture());
    const outcomeCount = virtualTextureGpuOutcomeCount(this.#gpu);
    for (let index = 0; index < outcomeCount; index += 1) {
      const outcome = virtualTextureGpuOutcome(this.#gpu, index);
      if (outcome === undefined) continue;
      const state = this.#runtime.get(outcome.key);
      if (state !== undefined && outcome.upload.sourceGeneration === state.sourceGeneration) {
        this.#runtime.requests.settleGpuPage(state, outcome.upload.pageKey);
      }
      firstFailure = captureFirstFailure(firstFailure, () => {
        this.#decodedSources.closeVirtualTexture(
          outcome.upload.payload.kind === "image"
            ? outcome.upload.payload.image
            : outcome.upload.payload.data,
        );
      });
    }
    clearVirtualTextureGpuOutcomes(this.#gpu);
    if (firstFailure !== undefined) throw firstFailure.value;
  }
}
