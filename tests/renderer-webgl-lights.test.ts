import { describe, expect, it } from "vitest";
import { identityMat4 } from "../packages/renderer-webgl/src/math/mat4";
import {
  combineSurfaceLightSets,
  surfaceLightSet,
  type SurfaceIblIrradiance,
  type SurfaceIblSpecular,
} from "../packages/renderer-webgl/src/webgl/lights";

const irradiance = (intensity: number): SurfaceIblIrradiance => ({
  coefficients: Array.from({ length: 9 }, () => [0, 0, 0] as const),
  intensity,
  worldToIbl: identityMat4(),
});

const specular = (key: string): SurfaceIblSpecular => ({
  encoding: "linear",
  intensity: 1,
  key,
  mipCount: 1,
  texture: {} as WebGLTexture,
  worldToIbl: identityMat4(),
});

describe("WebGL surface light composition", () => {
  it("uses the scene environment instead of an asset-embedded IBL", () => {
    const sceneIrradiance = irradiance(2);
    const sceneSpecular = specular("scene");
    const assetIrradiance = irradiance(3);
    const assetSpecular = specular("asset");

    const combined = combineSurfaceLightSets(
      surfaceLightSet([], sceneIrradiance, sceneSpecular),
      surfaceLightSet([], assetIrradiance, assetSpecular),
    );

    expect(combined.irradiance).toBe(sceneIrradiance);
    expect(combined.specular).toBe(sceneSpecular);
  });

  it("retains an asset-embedded IBL when the scene only adds punctual lighting", () => {
    const assetIrradiance = irradiance(3);
    const assetSpecular = specular("asset");
    const sceneLights = surfaceLightSet([{
      color: [1, 1, 1, 1],
      direction: [0, -1, 0],
      kind: "directional",
    }]);

    const combined = combineSurfaceLightSets(
      sceneLights,
      surfaceLightSet([], assetIrradiance, assetSpecular),
    );

    expect(combined.lights).toEqual(sceneLights.lights);
    expect(combined.irradiance).toBe(assetIrradiance);
    expect(combined.specular).toBe(assetSpecular);
  });
});
