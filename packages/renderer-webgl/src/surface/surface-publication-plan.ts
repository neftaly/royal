import type { CanonicalDrawSurface, CanonicalSurfaceScene } from "./scene-lowering";
import { surfaceProgramFeatureBits } from "./surface-texture-plan";

/** Shared policy for initial preparation and later texture publication. */
export const plannedSurfaceProgramFeatures = (
  scene: CanonicalSurfaceScene | null,
  surface: CanonicalDrawSurface,
  environmentFeatures: number,
  hasVirtualBaseColor: boolean,
  linearOutput: boolean,
  ordinaryTextureMask: number,
): number =>
  surfaceProgramFeatureBits({
    directionalLightCount: scene?.directionalLights.length ?? 0,
    environmentFeatures,
    hasTangent: surface.geometry.tangents !== undefined,
    hasVertexColor: surface.geometry.colors !== undefined,
    hasVertexNormal: surface.geometry.normals !== undefined,
    hasVirtualBaseColor,
    linearOutput,
    material: surface.material,
    ordinaryTextureMask,
    punctualLightCount: scene?.punctualLights.length ?? 0,
  });

export const surfaceMaterialLodDrawable = (
  surface: CanonicalDrawSurface,
  hasBaseColor: boolean,
): boolean =>
  surface.materialLodLevel !== true ||
  surface.material.baseColorAsset === undefined ||
  hasBaseColor;
