import type { VirtualTextureAssetRef } from "@royal/renderer-core";
import type { TextureSourceRef } from "../texture/asset-owner";
import type { SurfaceFrameView } from "../surface/surface-gpu-owner";
import type { CanonicalSurfaceScene } from "../surface/scene-lowering";
import type { TextureUnitBinding } from "../webgl/draw-state-transition";

export const virtualTextureAssetKey = (asset: VirtualTextureAssetRef): string => JSON.stringify([
  asset.contentKey ?? asset.manifestUri,
  asset.version ?? 0,
  asset.colorSpace ?? "",
  asset.sampler?.magFilter ?? "",
  asset.sampler?.minFilter ?? "",
  asset.sampler?.wrapS ?? "",
  asset.sampler?.wrapT ?? "",
]);

export const automaticVirtualTextureAssetKey = (asset: TextureSourceRef): string => JSON.stringify([
  asset.kind === "embedded-asset" ? asset.contentKey : asset.contentKey ?? asset.src,
  asset.kind === "embedded-asset" ? 0 : asset.version ?? 0,
  asset.colorSpace ?? "srgb",
  asset.sampler?.magFilter ?? "",
  asset.sampler?.minFilter ?? "",
  asset.sampler?.wrapS ?? "",
  asset.sampler?.wrapT ?? "",
]);

export type VirtualTextureSceneDemand = Readonly<{
  surfaces: readonly Readonly<{
    material: Readonly<{ baseColorAsset?: TextureSourceRef }>;
  }>[];
  virtualTextureAssets: readonly VirtualTextureAssetRef[];
}>;

/** Pure lazy-feature activation shared by root setup and stale import guards. */
export const virtualTextureRuntimeRequired = (
  scene: VirtualTextureSceneDemand,
  automaticVirtualTexturing: boolean,
): boolean => scene.virtualTextureAssets.length > 0 || (
  automaticVirtualTexturing
  && scene.surfaces.some((surface) => surface.material.baseColorAsset !== undefined)
);

export type VirtualTextureShaderSource = Readonly<{
  declarations: string;
}>;

export type VirtualTextureGpuBinding = Readonly<{
  atlas: TextureUnitBinding;
  pageTable: TextureUnitBinding;
  settings0: Float32Array;
  settings1: Float32Array;
  settings2: Float32Array;
}>;

export type VirtualTextureFrameUpdate = Readonly<{
  pending: boolean;
  webGlStateChanged: boolean;
}>;

export type VirtualTextureRuntimeSnapshot = Readonly<{
  /** VT upload bytes admitted during the most recent runtime update. */
  admittedUploadBytes: number;
  /** Compatible root-owned physical atlas pools. */
  atlasPools: number;
  /** Persistent GPU bytes claimed by physical atlas pools. */
  atlasBytes: number;
  /** Unique ordinary base-color assets considered by the latest scene. */
  automaticCandidates: number;
  /** Estimated CPU bytes retained by current automatic raster VT leases. */
  automaticDecodedBytes: number;
  /** `1` when automatic VT is enabled for this root, otherwise `0`. */
  automaticEnabled: number;
  /** Latest-scene candidates rejected by format, size, or decoded-memory policy. */
  automaticIneligible: number;
  /** Current automatic VT resources with a retained page source. */
  automaticResources: number;
  /** Latest-scene candidates still waiting for ordinary texture decode. */
  automaticWaiting: number;
  /** VT uploads deferred during the most recent runtime update. */
  deferredUploads: number;
  /** Page failures retained across the current resource generations. */
  failedPages: number;
  /** Page reads started during this runtime generation, including later evictions. */
  pageRequests: number;
  /** Current page reads and decoded pages waiting for upload. */
  pendingPages: number;
  /** Current logical pages backed by physical atlas slots. */
  residentPages: number;
  /** Successful page uploads during this runtime generation, including replacements. */
  uploadedPages: number;
  /** Immutable VT upload-byte target per runtime update. */
  uploadBudgetBytes: number;
}>;

/** Focused manifest lifecycle plus current bounded page residency. */
export type VirtualTextureAssetSnapshot = Readonly<{
  /** Page requests that ended in failure for the retained asset generation. */
  failedPages: number;
  /** Requested pages without usable coverage yet. */
  pendingPages: number;
  /** Currently resident physical atlas pages. */
  residentPages: number;
}> & (
  | Readonly<{
    error?: never;
    state: "idle" | "loading" | "ready";
  }>
  | Readonly<{
    error: string;
    state: "error" | "unsupported";
  }>
);

/** Narrow optional-feature seam; implementation and shader body remain lazy. */
export interface VirtualTextureRuntime {
  readonly bindingRevision: number;
  readonly shaderSource: VirtualTextureShaderSource;
  automaticBinding(asset: TextureSourceRef): VirtualTextureGpuBinding | undefined;
  binding(asset: VirtualTextureAssetRef): VirtualTextureGpuBinding | undefined;
  dispose(): void;
  invalidate(): void;
  invalidateSceneGeometry(): void;
  runtimeSnapshot(): VirtualTextureRuntimeSnapshot;
  snapshot(asset: VirtualTextureAssetRef): VirtualTextureAssetSnapshot;
  setScene(scene: CanonicalSurfaceScene | null): void;
  update(views: readonly SurfaceFrameView[]): VirtualTextureFrameUpdate;
}
