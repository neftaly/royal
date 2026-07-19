import type { VirtualTextureAssetRef } from "@royal/renderer-core";
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

export type VirtualTextureAssetSnapshot = Readonly<{
  failedPages: number;
  failure?: string;
  pendingPages: number;
  residentPages: number;
  state: "error" | "idle" | "loading" | "ready" | "unsupported";
}>;

/** Narrow optional-feature seam; implementation and shader body remain lazy. */
export interface VirtualTextureRuntime {
  readonly bindingRevision: number;
  readonly shaderSource: VirtualTextureShaderSource;
  binding(asset: VirtualTextureAssetRef): VirtualTextureGpuBinding | undefined;
  dispose(): void;
  invalidate(): void;
  snapshot(asset: VirtualTextureAssetRef): VirtualTextureAssetSnapshot;
  setScene(scene: CanonicalSurfaceScene | null): void;
  update(views: readonly SurfaceFrameView[]): VirtualTextureFrameUpdate;
}
