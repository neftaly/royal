import type { Material, VirtualTextureAssetRef } from "@royal/renderer-core";
import type { CpuGeometry } from "./geometry-recipes";
import type { Mat4 } from "./math/mat4";
import { isDecodedCompressedTexture, type LoadedTextureSource } from "./texture-sources";
import {
  emptyVirtualTextureSnapshot,
  type VirtualTextureFeature,
  type VirtualTextureFeatureOptions,
} from "./virtual-texture-feature";
import type {
  BaseColorTextureResidency,
  VirtualTextureDrawDemandContext,
  VirtualTextureDrawDemandModelSource,
  VirtualTextureRuntimeState,
  ViewportSize,
} from "./virtual-texture-runtime";
import type { VirtualTextureAssetSnapshot } from "./virtual-texture-runtime-shell";
import { textureCacheKey, type TextureAssetUploadRef } from "./webgl/materials";
import type { VirtualTextureGpuBinding } from "./webgl/virtual-texture-gpu-arena";
import type { VertexInputGeometry } from "./vertex-input-arena";

type VirtualTextureFeatureModule = typeof import("./virtual-texture-feature-owner");
type PendingAutoSource = {
  readonly source: LoadedTextureSource;
  readonly texture: TextureAssetUploadRef;
};

const EMPTY_RESOURCES: ReadonlyMap<string, VirtualTextureRuntimeState> = new Map();
let preloadedModule: VirtualTextureFeatureModule | undefined;

/** @internal Allows deterministic VT-focused tests to retain synchronous manifest staging. */
export const preloadVirtualTextureFeature = async (): Promise<void> => {
  preloadedModule ??= await import("./virtual-texture-feature-owner");
};

const failureMessage = (failure: unknown): string => failure instanceof Error
  ? failure.message
  : typeof failure === "string" ? failure : "Unknown virtual-texture runtime failure";

/** Loads the VT implementation on first authored or automatic VT demand. */
export class LazyVirtualTextureFeature implements VirtualTextureFeature {
  readonly #options: VirtualTextureFeatureOptions;
  readonly #pendingAutoSources = new Map<string, PendingAutoSource>();
  #failure: unknown;
  #feature: VirtualTextureFeature | undefined;
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
    this.#feature?.beginFrame();
  }

  beginView(viewIndex: number): void {
    this.#feature?.beginView(viewIndex);
  }

  bindGpuResource(
    key: string,
    atlasTextureUnit: number,
    pageTableTextureUnit: number,
  ): VirtualTextureGpuBinding | undefined {
    return this.#feature?.bindGpuResource(key, atlasTextureUnit, pageTableTextureUnit);
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
    this.#feature?.finishFrame(commit);
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
      case "solid": return { kind: "none" };
      case "asset": return { kind: "ordinary", texture: material.baseColor };
      case "virtual-asset": {
        this.#request();
        return { kind: "none" };
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
    this.#loading = import("./virtual-texture-feature-owner")
      .then((module) => {
        preloadedModule = module;
        this.#module = module;
        this.#activate();
      })
      .catch((error: unknown) => this.#fail(error));
  }
}
