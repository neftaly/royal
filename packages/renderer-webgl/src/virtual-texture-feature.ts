import type { Material, VirtualTextureAssetRef } from "@royal/renderer-core";
import type { WebGlContextCapabilities } from "./context-capability-owner";
import type { DecodedTextureSourceLifetime } from "./decoded-texture-source-lifetime";
import type { CpuGeometry } from "./geometry-recipes";
import type { Mat4 } from "./math/mat4";
import type { ResourceCapacityWakeOwner } from "./resource-capacity-wake-owner";
import type { ResourceGovernor } from "./resource-governor";
import type { WebGlContextLifecycle, WebGlVirtualTexturingSnapshot } from "./root-types";
import type { LoadedTextureSource } from "./texture-sources";
import type {
  BaseColorTextureResidency,
  VirtualTextureDrawDemandContext,
  VirtualTextureDrawDemandModelSource,
  VirtualTextureRef,
  VirtualTextureRuntimeState,
  ViewportSize,
} from "./virtual-texture-runtime";
import type {
  VirtualTextureAssetSnapshot,
  VirtualTextureRuntimeShellOptions,
} from "./virtual-texture-runtime-shell";
import type { TextureAssetUploadRef } from "./webgl/materials";
import type { TextureHandleArena } from "./webgl/texture-handle-arena";
import type { VirtualTextureGpuBinding } from "./webgl/virtual-texture-gpu-arena";
import type { VertexInputGeometry } from "./vertex-input-arena";

export type VirtualTextureFeatureOptions = {
  readonly active: () => boolean;
  readonly admitJob: VirtualTextureRuntimeShellOptions["admitJob"];
  readonly automaticVirtualTextures: boolean;
  readonly capabilities: () => WebGlContextCapabilities;
  readonly capacityWakes: ResourceCapacityWakeOwner;
  readonly contextGeneration: () => number;
  readonly contextLifecycle: () => WebGlContextLifecycle;
  readonly decodedSources: DecodedTextureSourceLifetime;
  readonly diagnostic: (message: string, key: string) => void;
  readonly disposed: () => boolean;
  readonly frame: () => number;
  readonly gl: WebGL2RenderingContext;
  readonly invalidate: () => void;
  readonly maximumDecodedCpuBytes: number;
  readonly maximumPersistentGpuBytes: number;
  readonly maximumUploadBytes: number;
  readonly recordUnsupported: (texture: VirtualTextureRef, reason: string) => void;
  readonly resourceGovernor: ResourceGovernor;
  readonly textureHandles: TextureHandleArena;
};

export interface VirtualTextureFeature {
  readonly resources: ReadonlyMap<string, VirtualTextureRuntimeState>;
  assetSnapshot(texture: VirtualTextureAssetRef): VirtualTextureAssetSnapshot | undefined;
  beginFrame(): void;
  beginView(viewIndex: number): void;
  bindGpuResource(
    key: string,
    atlasTextureUnit: number,
    pageTableTextureUnit: number,
  ): VirtualTextureGpuBinding | undefined;
  clear(): void;
  drainRequests(): void;
  drawDemandContext(
    geometryId: number,
    geometry: CpuGeometry,
    material: Material,
    modelSource: VirtualTextureDrawDemandModelSource,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
  ): VirtualTextureDrawDemandContext | undefined;
  dropGpuContext(): void;
  finishFrame(commit: boolean): void;
  hasActionableUploads(): boolean;
  isGpuDrawable(key: string): boolean;
  loseContext(): void;
  prepareFrame(authoredVirtualTextures: boolean): void;
  processGpuUploads(): void;
  registerAutoDecodedSource(texture: TextureAssetUploadRef, source: LoadedTextureSource): void;
  releaseAllGpuLeases(): void;
  releaseAutomaticTexture(textureKey: string): void;
  releaseAutoMetadata(textureKey: string): void;
  releaseGeometry(geometryId: number): void;
  releaseKey(key: string): void;
  releaseState(state: VirtualTextureRuntimeState): void;
  resolveBaseColorResidency(
    geometry: VertexInputGeometry,
    material: Material,
    demandContext: VirtualTextureDrawDemandContext | undefined,
  ): BaseColorTextureResidency;
  scheduleGovernedAdmissionRetry(): void;
  snapshot(unsupportedDraws: number): WebGlVirtualTexturingSnapshot;
  wakeDecodedCapacity(): boolean;
}

export const emptyVirtualTextureSnapshot = (
  physicalBudgetBytes: number,
  unsupportedDraws: number,
): WebGlVirtualTexturingSnapshot => ({
  activePages: 0,
  activePagesByMip: [],
  atlasTextures: 0,
  automaticManifestUses: 0,
  automaticPagesTarget: 0,
  automaticSourceBytes: 0,
  cachedPages: 0,
  cachedPagesByMip: [],
  demandAdmissions: 0,
  demandRetentionOverflows: 0,
  demandRetentions: 0,
  gpuAdmissionFailures: 0,
  manifestFailures: 0,
  manifestRequests: 0,
  manifestsReady: 0,
  outstandingPageRequests: 0,
  pageLifecycleEntries: 0,
  pageLoadDurationAverageMs: 0,
  pageLoadDurationMaxMs: 0,
  pageLoadDurationSamples: 0,
  pageLoadFailures: 0,
  pageLoadRequests: 0,
  pageTableTextures: 0,
  pageTableUpdates: 0,
  pendingPages: 0,
  physicalAllocatedBytes: 0,
  physicalBudgetBytes,
  physicalQuarantinedBytes: 0,
  preparedResidencyResolutions: 0,
  publishedDemandPages: 0,
  shaderBinds: 0,
  textureUploadBytesPerChunkMax: 0,
  textureUploadBytesPerChunkMin: 0,
  textureUploadChunkSamples: 0,
  unreadyDraws: 0,
  unsupportedDraws,
  uploadedPageBytes: 0,
  uploadedPages: 0,
  uploadQueueWaitAverageMs: 0,
  uploadQueueWaitMaxMs: 0,
  uploadQueueWaitMsByMip: [],
  uploadQueueWaitSamples: 0,
});
