import type { SurfaceFrameView } from "../frame/surface-frame";
import { textureStorageKey } from "../texture/source";
import type { CanonicalSurfaceScene } from "./scene-lowering";
import { collectVirtualFallbackStorageKeys } from "./surface-texture-plan";
import { frustumPlanesInto, worldBoundsVisible, type WorldBounds } from "./surface-visibility";

export type TextureWorkingSetPlan = Readonly<{
  alwaysActive: ReadonlySet<string>;
  surfaces: readonly Readonly<{ key: string; bounds: WorldBounds }>[];
}>;

/** Shared non-base uses keep ordinary ownership; only reloadable base maps are streamed. */
export const planTextureWorkingSet = (scene: CanonicalSurfaceScene): TextureWorkingSetPlan => {
  const pageable = collectVirtualFallbackStorageKeys(scene.surfaces.map(surface => surface.materialSource),
    asset => asset.sourceEncoding === undefined && asset.astc === undefined && asset.rasterPreview === undefined);
  return {
    alwaysActive: new Set(scene.textureAssets.map(textureStorageKey).filter(key => !pageable.has(key))),
    surfaces: scene.surfaces.flatMap(surface => {
      const asset = surface.materialSource.baseColorAsset;
      if (asset === undefined) return [];
      const key = textureStorageKey(asset);
      return pageable.has(key) ? [{ key, bounds: surface.worldBounds }] : [];
    }),
  };
};

/** Conservative union across canvas or stereo views, independent of resource residency. */
export const visibleTextureWorkingSet = (
  plan: TextureWorkingSetPlan, views: readonly SurfaceFrameView[], planes: Float32Array,
): ReadonlySet<string> => {
  const active = new Set(plan.alwaysActive);
  for (const view of views) {
    frustumPlanesInto(planes, view.viewProjection);
    for (const surface of plan.surfaces) {
      if (!active.has(surface.key) && worldBoundsVisible(surface.bounds, planes)) active.add(surface.key);
    }
  }
  return active;
};
