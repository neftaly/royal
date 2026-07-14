import type { EnvironmentLight } from "@royal/renderer-core";
import type { PreparedGltfState } from "./gltf/prepared-runtime";
import {
  identityMat4,
  inverseMat4,
  transformMat4,
  type Mat4,
} from "./math/mat4";
import type {
  IblSpecularTextureResource,
  StudioEnvironmentSpecularResource,
} from "./webgl/ibl-texture-arena";
import {
  surfaceLightSet,
  transformSurfaceIblIrradiance,
  transformSurfaceLight,
  type SurfaceImageBasedLightSpecular,
  type SurfaceIblIrradiance,
  type SurfaceIblSpecular,
  type SurfaceLight,
  type SurfaceLightSet,
} from "./webgl/lights";
import { STUDIO_ENVIRONMENT_IRRADIANCE } from "./webgl/studio-environment";

export interface SurfaceLightResolverOptions {
  readonly ensureGltfSpecular: (
    specular: SurfaceImageBasedLightSpecular,
  ) => IblSpecularTextureResource;
  readonly studioSpecular: () => StudioEnvironmentSpecularResource | undefined;
}

export type GltfSurfaceLightSource = Pick<PreparedGltfState, "imageBasedLight" | "lights">;

/** Owns scene/asset light-set resolution and stable glTF light-scope identity. */
export class SurfaceLightResolver {
  #gltfScopeIdCount = 0;
  readonly #gltfScopeIds = new Map<string, number>();
  readonly #options: SurfaceLightResolverOptions;
  #sceneCache: {
    readonly compiledLightSet: SurfaceLightSet | undefined;
    readonly compiledLights: readonly SurfaceLight[];
    readonly environment: EnvironmentLight;
    readonly resolved: SurfaceLightSet;
    readonly specular: StudioEnvironmentSpecularResource | undefined;
  } | undefined;

  constructor(options: SurfaceLightResolverOptions) {
    this.#options = options;
  }

  resolveScene(
    environment: EnvironmentLight | undefined,
    compiledLights: readonly SurfaceLight[],
    compiledLightSet: SurfaceLightSet | undefined,
  ): SurfaceLightSet | undefined {
    if (environment === undefined) return compiledLightSet;
    const specular = this.#options.studioSpecular();
    const cached = this.#sceneCache;
    if (
      cached !== undefined
      && cached.environment === environment
      && cached.compiledLights === compiledLights
      && cached.compiledLightSet === compiledLightSet
      && cached.specular === specular
    ) return cached.resolved;
    const worldFromIbl = transformMat4({
      position: [0, 0, 0],
      rotation: environment.rotation,
      scale: [1, 1, 1],
    });
    const worldToIbl = inverseMat4(worldFromIbl) ?? identityMat4();
    const resolved = surfaceLightSet(
      compiledLights,
      {
        coefficients: STUDIO_ENVIRONMENT_IRRADIANCE,
        intensity: environment.radianceScaleNits,
        worldToIbl,
      },
      specular === undefined
        ? undefined
        : {
            encoding: "linear",
            intensity: environment.radianceScaleNits,
            key: specular.key,
            mipCount: specular.mipCount,
            texture: specular.texture,
            worldToIbl,
        },
    );
    this.#sceneCache = { compiledLightSet, compiledLights, environment, resolved, specular };
    return resolved;
  }

  resolveGltfAsset(state: GltfSurfaceLightSource, rootModel: Mat4): SurfaceLightSet | undefined {
    const imageBasedLight = state.imageBasedLight;
    const irradiance = imageBasedLight === undefined
      ? undefined
      : transformSurfaceIblIrradiance(rootModel, imageBasedLight);
    const specular = imageBasedLight?.specular === undefined || irradiance === undefined
      ? undefined
      : this.#resolveGltfSpecular(imageBasedLight.specular, irradiance);
    if (state.lights.length === 0 && irradiance === undefined && specular === undefined) return undefined;
    return surfaceLightSet(
      state.lights.map((light) => transformSurfaceLight(rootModel, light)),
      irradiance,
      specular,
    );
  }

  gltfScopeId(stateKey: number, renderInstanceOrdinal: number, outerIndex: number): number {
    const key = `${stateKey}:${renderInstanceOrdinal}:${outerIndex}`;
    const existing = this.#gltfScopeIds.get(key);
    if (existing !== undefined) return existing;
    this.#gltfScopeIdCount += 1;
    if (!Number.isSafeInteger(this.#gltfScopeIdCount)) {
      throw new Error("Royal glTF light-scope ID space is exhausted");
    }
    this.#gltfScopeIds.set(key, this.#gltfScopeIdCount);
    return this.#gltfScopeIdCount;
  }

  clear(): void {
    this.#gltfScopeIds.clear();
    this.#gltfScopeIdCount = 0;
    this.#sceneCache = undefined;
  }

  #resolveGltfSpecular(
    specular: SurfaceImageBasedLightSpecular,
    irradiance: SurfaceIblIrradiance,
  ): SurfaceIblSpecular | undefined {
    const resource = this.#options.ensureGltfSpecular(specular);
    if (!resource.uploaded) return undefined;
    return {
      encoding: specular.encoding,
      intensity: irradiance.intensity,
      key: specular.key,
      mipCount: resource.mipCount,
      texture: resource.texture,
      worldToIbl: irradiance.worldToIbl,
    };
  }
}
