import type { Material, VirtualTextureAssetRef } from "@royal/renderer-core";
import type { CpuGeometry } from "../geometry-recipes";
import type { Mat4 } from "../math/mat4";
import { isDecodedCompressedTexture, type LoadedTextureSource } from "../texture/sources";
import {
  emptyVirtualTextureSnapshot,
  type VirtualTextureFeature,
  type VirtualTextureFeatureOptions,
} from "./feature";
import type {
  BaseColorTextureResidency,
  VirtualTextureDrawDemandContext,
  VirtualTextureDrawDemandModelSource,
  VirtualTextureRuntimeState,
  ViewportSize,
} from "./runtime";
import type { VirtualTextureAssetSnapshot } from "./runtime-shell";
import { textureCacheKey, type TextureAssetUploadRef } from "../webgl/materials";
import type { VirtualTextureGpuBinding } from "./gpu-arena";
import type { VertexInputGeometry } from "../vertex-input/arena";
import type { WebGlTextureBindingShell } from "../webgl/texture-binding-shell";

type VirtualTextureFeatureModule = typeof import("./feature-owner");
type PendingAutoSource = {
  readonly source: LoadedTextureSource;
  readonly texture: TextureAssetUploadRef;
};

const EMPTY_RESOURCES: ReadonlyMap<string, VirtualTextureRuntimeState> = new Map();
const NO_BASE_COLOR_RESIDENCY: BaseColorTextureResidency = { kind: "none" };
let preloadedModule: VirtualTextureFeatureModule | undefined;

/** @internal Allows deterministic VT-focused tests to retain synchronous manifest staging. */
export const preloadVirtualTextureFeature = async (): Promise<void> => {
  preloadedModule ??= await import("./feature-owner");
};

const failureMessage = (failure: unknown): string => failure instanceof Error
  ? failure.message
  : typeof failure === "string" ? failure : "Unknown virtual-texture runtime failure";

/** Loads the VT implementation on first authored or automatic VT demand. */
export class LazyVirtualTextureFeature implements VirtualTextureFeature {
  readonly #options: VirtualTextureFeatureOptions;
  #ordinaryResidency: { kind: "ordinary"; texture: TextureAssetUploadRef } | undefined;
  readonly #pendingAutoSources = new Map<string, PendingAutoSource>();
  #failure: unknown;
  #feature: VirtualTextureFeature | undefined;
  #frameFeature: VirtualTextureFeature | undefined;
  #frameOpen = false;
  #loading: Promise<void> | undefined;
  #module: VirtualTextureFeatureModule | undefined;
  #requested = false;

  constructor(options: VirtualTextureFeatureOptions) {
    this.#options = options;
  }

  get resources(): ReadonlyMap<string, VirtualTextureRuntimeState> {
    return this.#feature?.resources ?? EMPTY_RESOURCES;
  }

  assetSnapshot(texture: VirtualTextureAssetRef): VirtualTextureAssetSnapshot | undefined {
    this.#activate();
    if (this.#feature !== undefined) return this.#feature.assetSnapshot(texture);
    if (this.#failure !== undefined) {
      return {
        error: failureMessage(this.#failure),
        pendingPages: 0,
        state: "error",
      };
    }
    return this.#loading === undefined ? undefined : { pendingPages: 0, state: "loading" };
  }

  beginFrame(): void {
    this.#activate();
    this.#frameOpen = true;
    this.#frameFeature = this.#feature;
    this.#frameFeature?.beginFrame();
  }

  beginView(viewIndex: number): void {
    this.#feature?.beginView(viewIndex);
  }

  bindGpuResource(
    bindings: WebGlTextureBindingShell,
    key: string,
    atlasTextureUnit: number,
    pageTableTextureUnit: number,
  ): VirtualTextureGpuBinding | undefined {
    return this.#feature?.bindGpuResource(bindings, key, atlasTextureUnit, pageTableTextureUnit);
  }

  clear(): void {
    this.#pendingAutoSources.clear();
    this.#feature?.clear();
  }

  drainRequests(): void {
    this.#feature?.drainRequests();
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
    if (material.baseColor.kind === "virtual-asset") this.#request();
    return this.#feature?.drawDemandContext(
      geometryId,
      geometry,
      material,
      modelSource,
      projection,
      view,
      viewportSize,
    );
  }

  dropGpuContext(): void {
    this.#feature?.dropGpuContext();
  }

  finishFrame(commit: boolean): void {
    const feature = this.#frameFeature;
    this.#frameFeature = undefined;
    this.#frameOpen = false;
    feature?.finishFrame(commit);
  }

  hasActionableUploads(): boolean {
    return this.#feature?.hasActionableUploads() ?? false;
  }

  isGpuDrawable(key: string): boolean {
    return this.#feature?.isGpuDrawable(key) ?? false;
  }

  loseContext(): void {
    this.#feature?.loseContext();
  }

  prepareFrame(authoredVirtualTextures: boolean): void {
    if (authoredVirtualTextures || this.#pendingAutoSources.size > 0) this.#request();
    else this.#activate();
  }

  processGpuUploads(): void {
    this.#feature?.processGpuUploads();
  }

  requiresDrawDemand(geometry: CpuGeometry, material: Material): boolean {
    if (material.baseColor.kind === "virtual-asset") this.#request();
    return this.#feature?.requiresDrawDemand(geometry, material) ?? false;
  }

  registerAutoDecodedSource(texture: TextureAssetUploadRef, source: LoadedTextureSource): void {
    if (!this.#options.automaticVirtualTextures || isDecodedCompressedTexture(source)) return;
    if (this.#feature !== undefined) {
      this.#feature.registerAutoDecodedSource(texture, source);
      return;
    }
    this.#pendingAutoSources.set(textureCacheKey(texture), { source, texture });
    this.#request();
  }

  releaseAllGpuLeases(): void {
    this.#feature?.releaseAllGpuLeases();
  }

  releaseAutomaticTexture(textureKey: string): void {
    this.#pendingAutoSources.delete(textureKey);
    this.#feature?.releaseAutomaticTexture(textureKey);
  }

  releaseAutoMetadata(textureKey: string): void {
    this.#pendingAutoSources.delete(textureKey);
    this.#feature?.releaseAutoMetadata(textureKey);
  }

  releaseGeometry(geometryId: number): void {
    this.#feature?.releaseGeometry(geometryId);
  }

  releaseKey(key: string): void {
    this.#feature?.releaseKey(key);
  }

  releaseState(state: VirtualTextureRuntimeState): void {
    this.#feature?.releaseState(state);
  }

  resolveBaseColorResidency(
    geometry: VertexInputGeometry,
    material: Material,
    demandContext: VirtualTextureDrawDemandContext | undefined,
  ): BaseColorTextureResidency {
    if (this.#feature !== undefined) {
      return this.#feature.resolveBaseColorResidency(geometry, material, demandContext);
    }
    switch (material.baseColor.kind) {
      case "solid": return NO_BASE_COLOR_RESIDENCY;
      case "asset": {
        let residency = this.#ordinaryResidency;
        if (residency === undefined) {
          residency = { kind: "ordinary", texture: material.baseColor };
          this.#ordinaryResidency = residency;
        } else residency.texture = material.baseColor;
        return residency;
      }
      case "virtual-asset": {
        this.#request();
        return NO_BASE_COLOR_RESIDENCY;
      }
    }
  }

  scheduleGovernedAdmissionRetry(): void {
    this.#feature?.scheduleGovernedAdmissionRetry();
  }

  snapshot(unsupportedDraws: number) {
    return this.#feature?.snapshot(unsupportedDraws)
      ?? emptyVirtualTextureSnapshot(this.#options.maximumPersistentGpuBytes, unsupportedDraws);
  }

  wakeDecodedCapacity(): boolean {
    return this.#feature?.wakeDecodedCapacity() ?? false;
  }

  #activate(): void {
    this.#module ??= preloadedModule;
    if (
      this.#feature !== undefined
      || !this.#requested
      || this.#module === undefined
      || !this.#options.active()
      || this.#options.disposed()
    ) return;
    try {
      this.#feature = new this.#module.VirtualTextureFeatureOwner(this.#options);
      // Decoded ordinary images are applied after the root begins its frame.
      // Automatic-VT demand can therefore instantiate the lazy feature in the
      // middle of that frame; enroll it before any draw or finish call reaches
      // its frame-demand workspace.
      if (this.#frameOpen) {
        this.#feature.beginFrame();
        this.#frameFeature = this.#feature;
      }
      for (const { source, texture } of this.#pendingAutoSources.values()) {
        this.#feature.registerAutoDecodedSource(texture, source);
      }
      this.#pendingAutoSources.clear();
      this.#options.invalidate();
    } catch (error) {
      this.#fail(error);
    }
  }

  #fail(error: unknown): void {
    if (this.#failure !== undefined) return;
    this.#failure = error;
    const message = failureMessage(error);
    this.#options.diagnostic(
      `Virtual-texture runtime failed to load: ${message}`,
      "virtual-texture-runtime-load",
    );
    this.#options.invalidate();
  }

  #request(): void {
    this.#requested = true;
    this.#activate();
    if (
      this.#feature !== undefined
      || this.#failure !== undefined
      || this.#loading !== undefined
      || this.#options.disposed()
    ) return;
    if (preloadedModule !== undefined) {
      this.#module = preloadedModule;
      this.#activate();
      return;
    }
    this.#loading = import("./feature-owner")
      .then((module) => {
        preloadedModule = module;
        this.#module = module;
        this.#activate();
      })
      .catch((error: unknown) => this.#fail(error));
  }
}
