import type { CanonicalSurfaceScene } from "../surface/scene-lowering";
import { canonicalSurfaceIsDoubleSided } from "../surface/surface-pass-plan";
import { IDENTITY_TEXTURE_COORDINATES } from "../surface/texture-coordinates";
import { decodedTextureKey, textureStorageKey, type TextureSourceRef } from "../texture/source";
import type { VirtualTextureDemandSurface } from "./demand";
import { automaticVirtualTextureAssetKey } from "./runtime-contract";

export type AutomaticTextureCandidate = Readonly<{
  asset: TextureSourceRef;
  storageKey: string;
  surfaces: readonly VirtualTextureDemandSurface[];
}>;

/** Authored identity and geometry do not change when decoded bindings publish. */
export const planAutomaticTextureScene = (scene: CanonicalSurfaceScene | null) => {
  const candidates = new Map<string, { asset: TextureSourceRef; storageKey: string; surfaces: VirtualTextureDemandSurface[] }>();
  const decodedKeys = new Set<string>();
  for (const surface of scene?.surfaces ?? []) {
    const asset = surface.materialSource.baseColorAsset;
    if (asset === undefined) continue;
    const key = automaticVirtualTextureAssetKey(asset);
    let candidate = candidates.get(key);
    if (candidate === undefined) {
      candidate = { asset, storageKey: textureStorageKey(asset), surfaces: [] };
      candidates.set(key, candidate);
      decodedKeys.add(decodedTextureKey(asset));
    }
    candidate.surfaces.push({ geometry: surface.geometry, model: surface.model, worldBounds: surface.worldBounds,
      // Retained transforms may change handedness without replacing the scene.
      // Demand jobs snapshot this getter along with the model and bounds.
      get frontFace() { return canonicalSurfaceIsDoubleSided(surface.materialSource) ? undefined : surface.modelHandedness; },
      ...(surface.instances === undefined ? {} : { instances: surface.instances }),
      textureCoordinates: surface.materialSource.baseColorTextureCoordinates ?? IDENTITY_TEXTURE_COORDINATES });
  }
  return { candidates: candidates as ReadonlyMap<string, AutomaticTextureCandidate>, decodedKeys };
};
