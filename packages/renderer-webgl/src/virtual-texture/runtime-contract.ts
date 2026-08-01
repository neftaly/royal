import type { VirtualTextureAssetRef } from "@royal/renderer-core";
import type { SurfaceFrameView } from "../frame/surface-frame";
import { decodedTextureKey, type TextureSourceRef } from "../texture/source";
import {
  canonicalTextureSampler,
  canonicalTextureSamplerKey,
} from "../texture/sampler";
import type { CanonicalSurfaceScene } from "../surface/scene-lowering";
import type { TextureUnitBinding } from "../webgl/draw-state-transition";

const versionIdentity = (version: VirtualTextureAssetRef["version"]): readonly unknown[] =>
  version === undefined
    ? ["unversioned"]
    : ["version", typeof version, version];

export const virtualTextureAssetKey = (asset: VirtualTextureAssetRef): string => JSON.stringify([
  asset.contentKey === undefined
    ? ["manifest", asset.manifestUri]
    : ["content", typeof asset.contentKey, asset.contentKey],
  versionIdentity(asset.version),
  asset.colorSpace ?? "srgb",
  canonicalTextureSamplerKey(canonicalTextureSampler(asset)),
]);

export const automaticVirtualTextureAssetKey = (asset: TextureSourceRef): string => JSON.stringify([
  decodedTextureKey(asset),
  asset.colorSpace ?? "srgb",
  canonicalTextureSamplerKey(canonicalTextureSampler(asset)),
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
  /** Whether automatic VT is enabled for this root. */
  automaticEnabled: boolean;
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

/** Pure inactive-runtime snapshot preserving the root's immutable VT policy. */
export const idleVirtualTextureRuntimeSnapshot = (
  automaticVirtualTexturing: boolean,
  uploadBudgetBytes: number,
): VirtualTextureRuntimeSnapshot => ({
  admittedUploadBytes: 0,
  atlasBytes: 0,
  atlasPools: 0,
  automaticCandidates: 0,
  automaticDecodedBytes: 0,
  automaticEnabled: automaticVirtualTexturing,
  automaticIneligible: 0,
  automaticResources: 0,
  automaticWaiting: 0,
  deferredUploads: 0,
  failedPages: 0,
  pageRequests: 0,
  pendingPages: 0,
  residentPages: 0,
  uploadedPages: 0,
  uploadBudgetBytes,
});

/**
 * Focused manifest lifecycle plus current bounded page residency. `status` is
 * the shared focused-lifecycle discriminant.
 */
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
    status: "idle" | "loading" | "ready";
  }>
  | Readonly<{
    error: string;
    status: "error" | "unsupported";
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
