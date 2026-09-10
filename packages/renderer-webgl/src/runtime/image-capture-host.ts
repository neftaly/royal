import type { PrefilteredEnvironmentLight, Scene } from "@royal/renderer-core";
import type { PrefilteredEnvironmentAssetSnapshot } from "../environment/asset-owner";
import type { RendererRoot } from './canvas-root';
import type { CanonicalSurfaceScene } from '../surface/scene-lowering';
import type { TextureSourceRef, TextureAssetSnapshot } from '../texture/asset-owner';

/** @internal Capability used only by the optional capture entry point. */
export const rendererBeginImageCapture: unique symbol = Symbol('royal.webgl.image-capture');

export type RootImageCaptureHost = Readonly<{
  root: RendererRoot;
  intent(): Scene | null;
  hasOverlay(): boolean;
  hasExternalClock(): boolean;
  scene(): CanonicalSurfaceScene | null;
  pending(): boolean;
  environmentSnapshot(environment: Pick<PrefilteredEnvironmentLight, "src" | "version">): PrefilteredEnvironmentAssetSnapshot;
  textureSnapshot(texture: TextureSourceRef): TextureAssetSnapshot;
  now(): number;
  requestFrame(callback: () => void): void;
  release(): void;
}>;

export interface ImageCaptureCapableRoot {
  [rendererBeginImageCapture](): RootImageCaptureHost;
}
