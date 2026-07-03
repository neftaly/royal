import type {
  DirectionalLightNode,
  Rgba,
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

const DEFAULT_LIGHT_COLOR: Rgba = [1, 1, 1, 1];

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

export type SurfaceIblSpecularEncoding = "ldr" | "rgbd";

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
  readonly color: Rgba;
  readonly direction: Vec3;
  readonly kind: "directional";
};

export type SurfacePointLight = {
  readonly color: Rgba;
  readonly kind: "point";
  readonly position: Vec3;
  readonly range?: number;
};

export type SurfaceSpotLight = {
  readonly color: Rgba;
  readonly direction: Vec3;
  readonly innerConeAngle: number;
  readonly kind: "spot";
  readonly outerConeAngle: number;
  readonly position: Vec3;
  readonly range?: number;
};

export type SurfaceLight = SurfaceDirectionalLight | SurfacePointLight | SurfaceSpotLight;

export type SurfaceLightSet = {
  readonly irradiance?: SurfaceIblIrradiance;
  readonly key: string;
  readonly lights: readonly SurfaceLight[];
  readonly specular?: SurfaceIblSpecular;
};

export const DEFAULT_SURFACE_LIGHT_SET: SurfaceLightSet = {
  key: "default",
  lights: [{ color: DEFAULT_LIGHT_COLOR, direction: DEFAULT_LIGHT_DIRECTION, kind: "directional" }],
};

export const EMPTY_SURFACE_LIGHT_SET: SurfaceLightSet = {
  key: "empty",
  lights: [],
};

export const surfaceLightValueKey = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? "" : Number(value.toFixed(6)).toString();

export const surfaceLightVectorKey = (values: readonly number[]): string =>
  values.map((value) => surfaceLightValueKey(value)).join(",");

const surfaceIblIrradianceKey = (irradiance: SurfaceIblIrradiance): string =>
  [
    surfaceLightValueKey(irradiance.intensity),
    ...irradiance.coefficients.map((coefficient) => surfaceLightVectorKey(coefficient)),
    surfaceLightVectorKey(irradiance.worldToIbl),
  ].join(":");

const surfaceIblSpecularKey = (specular: SurfaceIblSpecular): string =>
  [
    specular.key,
    specular.encoding,
    surfaceLightValueKey(specular.intensity),
    surfaceLightValueKey(specular.mipCount),
    surfaceLightVectorKey(specular.worldToIbl),
  ].join(":");

const surfaceLightKey = (light: SurfaceLight): string => {
  switch (light.kind) {
    case "directional":
      return [
        "directional",
        surfaceLightVectorKey(light.color),
        surfaceLightVectorKey(light.direction),
      ].join(":");
    case "point":
      return [
        "point",
        surfaceLightVectorKey(light.color),
        surfaceLightVectorKey(light.position),
        surfaceLightValueKey(light.range),
      ].join(":");
    case "spot":
      return [
        "spot",
        surfaceLightVectorKey(light.color),
        surfaceLightVectorKey(light.position),
        surfaceLightVectorKey(light.direction),
        surfaceLightValueKey(light.range),
        surfaceLightValueKey(light.innerConeAngle),
        surfaceLightValueKey(light.outerConeAngle),
      ].join(":");
  }
};

export const surfaceLightSet = (
  lights: readonly SurfaceLight[],
  irradiance?: SurfaceIblIrradiance,
  specular?: SurfaceIblSpecular,
): SurfaceLightSet => {
  const useDefaultLight = lights.length === 0 && irradiance === undefined && specular === undefined;
  const actualLights = useDefaultLight ? DEFAULT_SURFACE_LIGHT_SET.lights : lights;
  const lightKey = useDefaultLight
    ? "default"
    : lights.length === 0 ? "none" : lights.map(surfaceLightKey).join("|");
  const irradianceKey = irradiance === undefined ? "" : `|ibl:${surfaceIblIrradianceKey(irradiance)}`;
  const specularKey = specular === undefined ? "" : `|ibl-specular:${surfaceIblSpecularKey(specular)}`;

  return {
    ...(irradiance === undefined ? {} : { irradiance }),
    key: `${lightKey}${irradianceKey}${specularKey}`,
    lights: actualLights,
    ...(specular === undefined ? {} : { specular }),
  };
};

export const passSurfaceLightSet = (light: DirectionalLightNode | undefined): SurfaceLightSet | undefined =>
  light === undefined
    ? undefined
    : surfaceLightSet([{
        color: light.color,
        direction: light.direction,
        kind: "directional",
      }]);

export const combineSurfaceLightSets = (
  passLights: SurfaceLightSet | undefined,
  assetLights: SurfaceLightSet | undefined,
): SurfaceLightSet => {
  if (passLights === undefined && assetLights === undefined) return DEFAULT_SURFACE_LIGHT_SET;
  if (assetLights === undefined) return passLights ?? DEFAULT_SURFACE_LIGHT_SET;
  if (passLights === undefined) return assetLights;
  const lights = [...passLights.lights, ...assetLights.lights].slice(0, MAX_SURFACE_LIGHTS);
  const irradiance = assetLights.irradiance ?? passLights.irradiance;
  const specular = assetLights.specular ?? passLights.specular;

  return {
    ...(irradiance === undefined ? {} : { irradiance }),
    ...(specular === undefined ? {} : { specular }),
    key: `${passLights.key}|${assetLights.key}`,
    lights,
  };
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
