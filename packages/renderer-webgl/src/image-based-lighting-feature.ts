import type { DecodedTextureSourceLifetime } from "./decoded-texture-source-lifetime";
import type { ResourceArena } from "./resource-arena";
import type { WebGlContextLifecycle } from "./root-types";
import type { LoadedTextureSource } from "./texture-sources";
import type { SurfaceExecutionSignals } from "./webgl/surface-execution-arena";
import type {
  IblSpecularTextureResource,
  IblTextureGpuGovernor,
  StudioEnvironmentSpecularResource,
} from "./webgl/ibl-texture-arena";
import type { SurfaceImageBasedLightSpecular, SurfaceLightSet } from "./webgl/lights";
import type { ProgramArena } from "./webgl/program-arena";

export type ImageBasedLightingFeatureOptions = {
  readonly contextLifecycle: () => WebGlContextLifecycle;
  readonly decodedTextureSources: DecodedTextureSourceLifetime;
  readonly diagnostic: (message: string, key: string) => void;
  readonly gl: WebGL2RenderingContext;
  readonly governor: IblTextureGpuGovernor;
  readonly invalidate: () => void;
  readonly resourceArena: ResourceArena;
};

export interface ImageBasedLightingFeature {
  bindSurface(
    programs: ProgramArena,
    program: WebGLProgram,
    lightSet: SurfaceLightSet,
    specularTextureUnit: number | undefined,
    brdfLutTextureUnit: number | undefined,
  ): void;
  consumeSurfaceSignals(): SurfaceExecutionSignals;
  dropContext(): void;
  ensureSpecular(specular: SurfaceImageBasedLightSpecular): IblSpecularTextureResource;
  prepareBrdfLut(): boolean;
  releaseContextHandles(): void;
  releaseSpecular(key: string): void;
  settleSpecularImage(
    specular: SurfaceImageBasedLightSpecular,
    key: string,
    image: LoadedTextureSource,
  ): void;
  studioSpecular(): StudioEnvironmentSpecularResource | undefined;
  wakeDurablePressure(): boolean;
}
