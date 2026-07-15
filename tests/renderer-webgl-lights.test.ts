import { describe, expect, it } from "vitest";
import { identityMat4 } from "../packages/renderer-webgl/src/math/mat4";
import {
  combineSurfaceLightSets,
  createSurfaceLightTransformWorkspace,
  createSurfaceLightSetWorkspace,
  surfaceLightSet,
  writeTransformedSurfaceLightSet,
  writeCombinedSurfaceLightSet,
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

  it("writes composition into reusable caller-owned storage", () => {
    const sceneEnvironment = irradiance(2);
    const directional = {
      color: [1, 1, 1, 1] as const,
      direction: [0, -1, 0] as const,
      kind: "directional" as const,
    };
    const point = {
      color: [1, 1, 1, 1] as const,
      kind: "point" as const,
      position: [0, 1, 0] as const,
    };
    const output = createSurfaceLightSetWorkspace();

    expect(writeCombinedSurfaceLightSet(
      output,
      surfaceLightSet([directional], sceneEnvironment),
      surfaceLightSet([point], irradiance(3)),
    )).toBe(output);
    expect(output.lights).toEqual([directional, point]);
    expect(output.directionals).toEqual([directional]);
    expect(output.punctuals).toEqual([point]);
    expect(output.irradiance).toBe(sceneEnvironment);

    writeCombinedSurfaceLightSet(output, undefined, undefined);
    expect(output).toEqual({ directionals: [], lights: [], punctuals: [] });
  });

  it("reuses transformed light slots while updating their values", () => {
    const workspace = createSurfaceLightTransformWorkspace();
    const source = {
      color: [1, 1, 1, 1] as const,
      kind: "point" as const,
      position: [1, 2, 3] as const,
    };
    const model = identityMat4();
    const first = writeTransformedSurfaceLightSet(workspace, model, [source]);
    const slot = first.lights[0];
    expect(slot).toMatchObject({ position: [1, 2, 3] });

    model[12] = 5;
    const second = writeTransformedSurfaceLightSet(workspace, model, [source]);
    expect(second).toBe(first);
    expect(second.lights[0]).toBe(slot);
    expect(second.lights[0]).toMatchObject({ position: [6, 2, 3] });
  });
});
