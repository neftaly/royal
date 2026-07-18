import type {
  LinearRgba,
  Vec3,
} from "@royal/renderer-core";
import {
  identityMat4,
  inverseMat4Into,
  multiplyMat4Into,
  transformDirectionInto,
  transformMat4Into,
  transformPointInto,
  type Mat4,
  type MutableMat4,
  type MutableVec3,
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
  readonly range?: number | undefined;
};

export type SurfaceSpotLight = {
  readonly color: LinearRgba;
  readonly direction: Vec3;
  readonly innerConeAngle: number;
  readonly kind: "spot";
  readonly outerConeAngle: number;
  readonly position: Vec3;
  readonly range?: number | undefined;
};

export type SurfaceLight = SurfaceDirectionalLight | SurfacePointLight | SurfaceSpotLight;

export type SurfaceLightSet = {
  readonly directionals: readonly SurfaceDirectionalLight[];
  readonly irradiance?: SurfaceIblIrradiance | undefined;
  readonly lights: readonly SurfaceLight[];
  readonly punctuals: readonly (SurfacePointLight | SurfaceSpotLight)[];
  readonly specular?: SurfaceIblSpecular | undefined;
};

/** Caller-owned storage for allocation-free light-set composition. */
export type SurfaceLightSetWorkspace = {
  directionals: SurfaceDirectionalLight[];
  irradiance: SurfaceIblIrradiance | undefined;
  lights: SurfaceLight[];
  punctuals: Array<SurfacePointLight | SurfaceSpotLight>;
  specular: SurfaceIblSpecular | undefined;
};

export type SurfaceLightTransformWorkspace = {
  readonly lightSlots: SurfaceLight[];
  readonly resolved: SurfaceLightSetWorkspace;
};

export type SurfaceIblIrradianceTransformWorkspace = {
  readonly resolved: {
    coefficients: readonly Vec3[];
    intensity: number;
    worldToIbl: MutableMat4;
  };
  readonly worldFromIbl: MutableMat4;
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
  irradiance: undefined,
  lights: [],
  punctuals: [],
  specular: undefined,
});

export const createSurfaceLightTransformWorkspace = (): SurfaceLightTransformWorkspace => ({
  lightSlots: [],
  resolved: createSurfaceLightSetWorkspace(),
});

export const createSurfaceIblIrradianceTransformWorkspace =
  (): SurfaceIblIrradianceTransformWorkspace => ({
    resolved: {
      coefficients: [],
      intensity: 0,
      worldToIbl: identityMat4(),
    },
    worldFromIbl: identityMat4(),
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
  output.irradiance = irradiance;
  output.specular = specular;
  return output;
};

type MutableDirectionalLight = {
  color: LinearRgba;
  direction: MutableVec3;
  kind: "directional";
};
type MutablePointLight = {
  color: LinearRgba;
  kind: "point";
  position: MutableVec3;
  range: number | undefined;
};
type MutableSpotLight = {
  color: LinearRgba;
  direction: MutableVec3;
  innerConeAngle: number;
  kind: "spot";
  outerConeAngle: number;
  position: MutableVec3;
  range: number | undefined;
};
type MutableSurfaceLight = MutableDirectionalLight | MutablePointLight | MutableSpotLight;

const createSurfaceLightTransformSlot = (light: SurfaceLight): MutableSurfaceLight => {
  switch (light.kind) {
    case "directional":
      return { color: light.color, direction: [0, 0, -1], kind: "directional" };
    case "point":
      return { color: light.color, kind: "point", position: [0, 0, 0], range: light.range };
    case "spot":
      return {
        color: light.color,
        direction: [0, 0, -1],
        innerConeAngle: light.innerConeAngle,
        kind: "spot",
        outerConeAngle: light.outerConeAngle,
        position: [0, 0, 0],
        range: light.range,
      };
  }
};

const writeSurfaceLightTransformSlot = (
  output: MutableSurfaceLight,
  model: Mat4,
  light: SurfaceLight,
): void => {
  if (output.kind !== light.kind) {
    throw new Error("Royal surface light transform slot kind does not match its source");
  }
  output.color = light.color;
  switch (light.kind) {
    case "directional":
      transformDirectionInto((output as MutableDirectionalLight).direction, model, light.direction);
      return;
    case "point": {
      const point = output as MutablePointLight;
      transformPointInto(point.position, model, light.position);
      point.range = light.range;
      return;
    }
    case "spot": {
      const spot = output as MutableSpotLight;
      transformDirectionInto(spot.direction, model, light.direction);
      transformPointInto(spot.position, model, light.position);
      spot.innerConeAngle = light.innerConeAngle;
      spot.outerConeAngle = light.outerConeAngle;
      spot.range = light.range;
    }
  }
};

export const writeTransformedSurfaceLightSet = (
  workspace: SurfaceLightTransformWorkspace,
  model: Mat4,
  lights: readonly SurfaceLight[],
  irradiance?: SurfaceIblIrradiance,
  specular?: SurfaceIblSpecular,
): SurfaceLightSetWorkspace => {
  const output = workspace.resolved;
  output.directionals.length = 0;
  output.lights.length = 0;
  output.punctuals.length = 0;
  for (let index = 0; index < lights.length; index += 1) {
    const source = lights[index]!;
    let slot = workspace.lightSlots[index] as MutableSurfaceLight | undefined;
    if (slot === undefined || slot.kind !== source.kind) {
      slot = createSurfaceLightTransformSlot(source);
      workspace.lightSlots[index] = slot;
    }
    writeSurfaceLightTransformSlot(slot, model, source);
    output.lights.push(slot);
    if (slot.kind === "directional") output.directionals.push(slot);
    else output.punctuals.push(slot);
  }
  workspace.lightSlots.length = lights.length;
  output.irradiance = irradiance;
  output.specular = specular;
  return output;
};

export const writeTransformedSurfaceIblIrradiance = (
  workspace: SurfaceIblIrradianceTransformWorkspace,
  model: Mat4,
  light: SurfaceImageBasedLight,
): SurfaceIblIrradiance => {
  multiplyMat4Into(workspace.worldFromIbl, model, light.rotation);
  if (inverseMat4Into(workspace.resolved.worldToIbl, workspace.worldFromIbl) === undefined) {
    transformMat4Into(workspace.resolved.worldToIbl, undefined);
  }
  workspace.resolved.coefficients = light.coefficients;
  workspace.resolved.intensity = light.intensity;
  return workspace.resolved;
};
