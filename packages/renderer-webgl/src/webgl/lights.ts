import type {
  LinearRgba,
  Vec3,
} from "@royal/renderer-core";
import {
  identityMat4,
  inverseMat4,
  multiplyMat4,
  transformDirection,
  transformPoint,
  type Mat4,
} from "../math/mat4";

export const DEFAULT_LIGHT_DIRECTION: Vec3 = [0, -1, 0];
export const MAX_SURFACE_LIGHTS = 8;

export type SurfaceImageBasedLight = {
  readonly coefficients: readonly Vec3[];
  readonly intensity: number;
  readonly rotation: Mat4;
  readonly specular?: SurfaceImageBasedLightSpecular;
};

export type SurfaceImageBasedLightSpecular = {
  readonly encoding: SurfaceIblSpecularEncoding;
  readonly imageLoadKeys: readonly (readonly string[])[];
  readonly imageSize: number;
  readonly key: string;
};

export type SurfaceIblSpecularEncoding = "linear" | "rgbd";

export type SurfaceIblIrradiance = {
  readonly coefficients: readonly Vec3[];
  readonly intensity: number;
  readonly worldToIbl: Mat4;
};

export type SurfaceIblSpecular = {
  readonly encoding: SurfaceIblSpecularEncoding;
  readonly key: string;
  readonly mipCount: number;
  readonly intensity: number;
  readonly texture: WebGLTexture;
  readonly worldToIbl: Mat4;
};

export type SurfaceDirectionalLight = {
  readonly color: LinearRgba;
  readonly direction: Vec3;
  readonly kind: "directional";
};

export type SurfacePointLight = {
  readonly color: LinearRgba;
  readonly kind: "point";
  readonly position: Vec3;
  readonly range?: number;
};

export type SurfaceSpotLight = {
  readonly color: LinearRgba;
  readonly direction: Vec3;
  readonly innerConeAngle: number;
  readonly kind: "spot";
  readonly outerConeAngle: number;
  readonly position: Vec3;
  readonly range?: number;
};

export type SurfaceLight = SurfaceDirectionalLight | SurfacePointLight | SurfaceSpotLight;

export type SurfaceLightSet = {
  readonly directionals: readonly SurfaceDirectionalLight[];
  readonly irradiance?: SurfaceIblIrradiance;
  readonly lights: readonly SurfaceLight[];
  readonly punctuals: readonly (SurfacePointLight | SurfaceSpotLight)[];
  readonly specular?: SurfaceIblSpecular;
};

/** Caller-owned storage for allocation-free light-set composition. */
export type SurfaceLightSetWorkspace = {
  directionals: SurfaceDirectionalLight[];
  irradiance?: SurfaceIblIrradiance;
  lights: SurfaceLight[];
  punctuals: Array<SurfacePointLight | SurfaceSpotLight>;
  specular?: SurfaceIblSpecular;
};

export const EMPTY_SURFACE_LIGHT_SET: SurfaceLightSet = {
  directionals: [],
  lights: [],
  punctuals: [],
};

export const surfaceLightValueKey = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? "" : Math.fround(value).toString();

export const surfaceLightVectorKey = (values: readonly number[]): string =>
  values.map((value) => surfaceLightValueKey(value)).join(",");

export const surfaceLightSet = (
  lights: readonly SurfaceLight[],
  irradiance?: SurfaceIblIrradiance,
  specular?: SurfaceIblSpecular,
): SurfaceLightSet => {
  return {
    directionals: lights.filter((light): light is SurfaceDirectionalLight => light.kind === "directional"),
    ...(irradiance === undefined ? {} : { irradiance }),
    lights,
    punctuals: lights.filter((light): light is SurfacePointLight | SurfaceSpotLight => light.kind !== "directional"),
    ...(specular === undefined ? {} : { specular }),
  };
};

export const combineSurfaceLightSets = (
  sceneLights: SurfaceLightSet | undefined,
  assetLights: SurfaceLightSet | undefined,
): SurfaceLightSet => {
  if (sceneLights === undefined && assetLights === undefined) return EMPTY_SURFACE_LIGHT_SET;
  if (assetLights === undefined) return sceneLights ?? EMPTY_SURFACE_LIGHT_SET;
  if (sceneLights === undefined) return assetLights;
  const lights = [...sceneLights.lights, ...assetLights.lights];
  const sceneHasEnvironment = sceneLights.irradiance !== undefined || sceneLights.specular !== undefined;
  const irradiance = sceneHasEnvironment ? sceneLights.irradiance : assetLights.irradiance;
  const specular = sceneHasEnvironment ? sceneLights.specular : assetLights.specular;

  return surfaceLightSet(lights, irradiance, specular);
};

export const createSurfaceLightSetWorkspace = (): SurfaceLightSetWorkspace => ({
  directionals: [],
  lights: [],
  punctuals: [],
});

const appendSurfaceLightSet = (
  output: SurfaceLightSetWorkspace,
  lightSet: SurfaceLightSet | undefined,
): void => {
  if (lightSet === undefined) return;
  for (const light of lightSet.lights) {
    output.lights.push(light);
    if (light.kind === "directional") output.directionals.push(light);
    else output.punctuals.push(light);
  }
};

/**
 * Deterministically composes light sets into caller-owned storage.
 * The output must not alias either input.
 */
export const writeCombinedSurfaceLightSet = (
  output: SurfaceLightSetWorkspace,
  sceneLights: SurfaceLightSet | undefined,
  assetLights: SurfaceLightSet | undefined,
): SurfaceLightSetWorkspace => {
  output.directionals.length = 0;
  output.lights.length = 0;
  output.punctuals.length = 0;
  appendSurfaceLightSet(output, sceneLights);
  appendSurfaceLightSet(output, assetLights);

  const sceneHasEnvironment = sceneLights?.irradiance !== undefined || sceneLights?.specular !== undefined;
  const irradiance = sceneHasEnvironment ? sceneLights?.irradiance : assetLights?.irradiance;
  const specular = sceneHasEnvironment ? sceneLights?.specular : assetLights?.specular;
  if (irradiance === undefined) delete output.irradiance;
  else output.irradiance = irradiance;
  if (specular === undefined) delete output.specular;
  else output.specular = specular;
  return output;
};

export const transformSurfaceIblIrradiance = (
  model: Mat4,
  light: SurfaceImageBasedLight,
): SurfaceIblIrradiance => {
  const worldFromIbl = multiplyMat4(model, light.rotation);

  return {
    coefficients: light.coefficients,
    intensity: light.intensity,
    worldToIbl: inverseMat4(worldFromIbl) ?? identityMat4(),
  };
};

export const transformSurfaceLight = (model: Mat4, light: SurfaceLight): SurfaceLight => {
  switch (light.kind) {
    case "directional":
      return {
        color: light.color,
        direction: transformDirection(model, light.direction),
        kind: "directional",
      };
    case "point":
      return {
        color: light.color,
        kind: "point",
        position: transformPoint(model, light.position),
        ...(light.range === undefined ? {} : { range: light.range }),
      };
    case "spot":
      return {
        color: light.color,
        direction: transformDirection(model, light.direction),
        innerConeAngle: light.innerConeAngle,
        kind: "spot",
        outerConeAngle: light.outerConeAngle,
        position: transformPoint(model, light.position),
        ...(light.range === undefined ? {} : { range: light.range }),
      };
  }
};
