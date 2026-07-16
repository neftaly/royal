import type { Mat4 } from "./math/mat4";
import type {
  ClusteredLightGpuGovernor,
  ClusteredLightTextureUnits,
} from "./webgl/clustered-light-arena";
import type { SurfacePointLight, SurfaceSpotLight } from "./webgl/lights";
import type { ProgramArena } from "./webgl/program-arena";

export type ClusteredLightingFeatureOptions = {
  readonly gl: WebGL2RenderingContext;
  readonly governor: ClusteredLightGpuGovernor;
};

export type LazyClusteredLightingFeatureOptions = ClusteredLightingFeatureOptions & {
  readonly active: () => boolean;
  readonly diagnostic: (message: string, key: string) => void;
  readonly disposed: () => boolean;
  readonly invalidate: () => void;
};

/** Optional Forward+ punctual-light GPU feature boundary. */
export interface ClusteredLightingFeature {
  bind(
    programs: ProgramArena,
    program: WebGLProgram,
    lights: readonly (SurfacePointLight | SurfaceSpotLight)[],
    projection: Mat4,
    view: Mat4,
    width: number,
    height: number,
    frame: number,
  ): void;
  configure(maxTextureImageUnits: number, maxTextureSize: number): void;
  dropContext(): void;
  /** Returns false while a demanded optional implementation is still loading. */
  prepare(lights: readonly (SurfacePointLight | SurfaceSpotLight)[]): boolean;
  releaseContextHandles(): void;
  textureUnits(): ClusteredLightTextureUnits;
}
