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

export type VirtualTextureShaderSource = Readonly<{
  declarations: string;
}>;

export type VirtualTextureGpuBinding = Readonly<{
  atlas: TextureUnitBinding;
  mipOffsets: Float32Array;
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
  automaticCandidates: number;
  automaticDecodedBytes: number;
  automaticEnabled: number;
  automaticIneligible: number;
  automaticResources: number;
  automaticWaiting: number;
  failedPages: number;
  pageRequests: number;
  pendingPages: number;
  residentPages: number;
  uploadedPages: number;
}>;

export type VirtualTextureAssetSnapshot = Readonly<{
  failedPages: number;
  pendingPages: number;
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
  runtimeSnapshot(): VirtualTextureRuntimeSnapshot;
  snapshot(asset: VirtualTextureAssetRef): VirtualTextureAssetSnapshot;
  setScene(scene: CanonicalSurfaceScene | null): void;
  update(views: readonly SurfaceFrameView[]): VirtualTextureFrameUpdate;
}
