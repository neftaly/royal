import { automaticVirtualTextureEligible, automaticVirtualTextureHasPreview } from "./automatic-policy";
import type { VirtualTextureAssetRef } from "@royal/renderer-core";
import type { SurfaceFrameView } from "../frame/surface-frame";
import { decodedTextureKey, type DecodedTextureSource, type TextureSourceRef } from "../texture/source";
import {
  canonicalTextureSampler,
  canonicalTextureSamplerKey,
} from "../texture/sampler";
import type { CanonicalSurfaceScene } from "../surface/scene-lowering";
import type { TextureUnitBinding } from "../webgl/draw-state-transition";

export const virtualTextureAssetKey = (asset: VirtualTextureAssetRef): string => {
  const sampler = canonicalTextureSampler(asset);
  return JSON.stringify([
    asset.contentKey === undefined ? "manifest" : typeof asset.contentKey,
    asset.contentKey === undefined ? asset.manifestUri : asset.contentKey,
    typeof asset.version, asset.version,
    asset.colorSpace ?? "srgb",
    sampler.magFilter, sampler.minFilter, sampler.wrapS, sampler.wrapT,
  ]);
};

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
  decoded: (asset: TextureSourceRef) => DecodedTextureSource | undefined,
): boolean => scene.virtualTextureAssets.length > 0
  || scene.surfaces.some((surface) => {
    const asset = surface.material.baseColorAsset;
    const source = asset === undefined ? undefined : decoded(asset);
    return source !== undefined
      && (automaticVirtualTextureHasPreview(source) || automaticVirtualTextureEligible(source));
  });

export type VirtualTextureShaderSource = Readonly<{
  declarations: string;
}>;

export type VirtualTextureGpuBinding = Readonly<{
  atlas: TextureUnitBinding;
  compressedAtlas?: TextureUnitBinding;
  compressedSettings?: Float32Array;
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
  /** Cumulative page-stage elapsed time; parallel jobs overlap. Growth counts pool-frames. */
  pageQueueMs?: number;
  /** Estimated projected contribution with admitted detail resident; not GPU visibility feedback. */
  visibleDetailFraction?: number;
  pageReadMs?: number;
  pageReadyWaitMs?: number;
  pageTimedReads?: number;
  pageTimedUploads?: number;
  atlasGrowthFrames?: number;
  /** Background ASTC storage including any unfinished replacement. */
  idleAstcBytes?: number;
  /** Retained foreground pixels reused by the idle encoder, without rereading the source. */
  idleAstcPixelHits?: number;
  idleAstcSourceReads?: number;
  /** Bounded uncompressed handoff cache, included in automaticDecodedBytes. */
  retainedPagePixelBytes?: number;
  /** Optional background failure; usable RGBA pages remain resident. */
  idleAstcFailure?: string;
  /** VT upload bytes admitted during the most recent runtime update. */
  admittedUploadBytes: number;
  /** Compatible root-owned physical atlas pools. */
  atlasPools: number;
  /** Persistent GPU bytes claimed by physical atlas pools. */
  atlasBytes: number;
  /** Failed growth attempts; existing atlas coverage is retained. */
  atlasGrowthFailures: number;
  /** Most recent failed migration stage and cause, without an additional GL query. */
  lastAtlasGrowthFailure?: string;
  /** Bounded requested count after workspace coarsening, before capacity fitting. */
  desiredPages: number;
  /** Page count after fitting demand to current per-texture capacity. */
  admittedPages: number;
  /** Admitted demand without resident authoritative coverage yet, including failures. */
  unresidentPages: number;
  /** Unique ordinary base-color assets considered by the latest scene. */
  automaticCandidates: number;
  /** Estimated automatic raster leases, retained ASTC blocks. */
  automaticDecodedBytes: number;
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
  /** Reserved upper bound for in-flight and decoded page pixels. */
  pendingPageBytes: number;
  /** Hard root-local ceiling for pending page pixels. */
  pendingPageByteLimit: number;
  /** Current page reads and decoded pages waiting for upload. */
  pendingPages: number;
  /** Current logical pages backed by physical atlas slots. */
  residentPages: number;
  /** Successful page uploads during this runtime generation, including replacements. */
  uploadedPages: number;
  /** Immutable VT upload-byte target per runtime update. */
  uploadBudgetBytes: number;
}>;

/** Pure inactive-runtime snapshot preserving the root's upload budget. */
export const idleVirtualTextureRuntimeSnapshot = (
  uploadBudgetBytes: number,
): VirtualTextureRuntimeSnapshot => ({
  admittedUploadBytes: 0,
  atlasBytes: 0,
  atlasPools: 0,
  atlasGrowthFailures: 0,
  desiredPages: 0,
  admittedPages: 0,
  unresidentPages: 0,
  automaticCandidates: 0,
  automaticDecodedBytes: 0,
  automaticIneligible: 0,
  automaticResources: 0,
  automaticWaiting: 0,
  deferredUploads: 0,
  failedPages: 0,
  pageRequests: 0,
  pendingPages: 0,
  pendingPageBytes: 0,
  pendingPageByteLimit: 16 * 1024 * 1024,
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
  /** Undefined while a referenced authored manifest is pending; false when none can allocate. */
  readonly authoredStorageRequired: boolean | undefined;
  readonly bindingRevision: number;
  readonly shaderSource: VirtualTextureShaderSource;
  automaticBinding(asset: TextureSourceRef): VirtualTextureGpuBinding | undefined;
  binding(asset: VirtualTextureAssetRef): VirtualTextureGpuBinding | undefined;
  dispose(): void;
  invalidate(): void;
  invalidateSceneGeometry(): void;
  releaseRasterSource(asset: TextureSourceRef): void;
  runtimeSnapshot(): VirtualTextureRuntimeSnapshot;
  snapshot(asset: VirtualTextureAssetRef): VirtualTextureAssetSnapshot;
  setScene(scene: CanonicalSurfaceScene | null): void;
  /** Embedded surface frames already reset the shared upload authority. */
  update(views: readonly SurfaceFrameView[], beginUploadFrame?: boolean): VirtualTextureFrameUpdate;
}
