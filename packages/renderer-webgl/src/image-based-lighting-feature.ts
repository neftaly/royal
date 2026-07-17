import type { DecodedTextureSourceLifetime } from "./texture/decoded-source-lifetime";
import type { ResourceArena } from "./resource-arena";
import type { WebGlContextLifecycle } from "./root-types";
import type { LoadedTextureSource } from "./texture/sources";
import type { SurfaceExecutionSignals } from "./webgl/surface-execution-arena";
import type {
  IblSpecularTextureResource,
  IblTextureGpuGovernor,
  StudioEnvironmentSpecularResource,
} from "./webgl/ibl-texture-arena";
import type { SurfaceImageBasedLightSpecular, SurfaceLightSet } from "./webgl/lights";
import type { ProgramArena } from "./webgl/program-arena";
import type { WebGlTextureBindingShell } from "./webgl/texture-binding-shell";
import type { PrefilteredEnvironmentLight } from "@royal/renderer-core";
import type { ResolvedPrefilteredEnvironment } from "./environment/prefiltered-environment-owner";

export type ImageBasedLightingFeatureOptions = {
  readonly contextLifecycle: () => WebGlContextLifecycle;
  readonly diagnostic: (message: string, key: string) => void;
  readonly disposed: () => boolean;
  readonly gl: WebGL2RenderingContext;
  readonly governor: IblTextureGpuGovernor;
  readonly invalidate: () => void;
  readonly resourceArena: ResourceArena;
};

export interface ImageBasedLightingFeature {
  bindSurface(
    bindings: WebGlTextureBindingShell,
    programs: ProgramArena,
    program: WebGLProgram,
    lightSet: SurfaceLightSet,
    specularTextureUnit: number | undefined,
    brdfLutTextureUnit: number | undefined,
    bindUniforms: boolean,
  ): void;
  consumeSurfaceSignals(): SurfaceExecutionSignals;
  dropContext(): void;
  ensureSpecular(specular: SurfaceImageBasedLightSpecular): IblSpecularTextureResource;
  prepareBrdfLut(): boolean;
  releaseContextHandles(): void;
  releaseSpecular(key: string): void;
  /** Rebuilds a GPU resource after its source table was synchronously retained. */
  refreshRetainedSpecular(specular: SurfaceImageBasedLightSpecular): void;
  resolvePrefilteredEnvironment(
    environment: PrefilteredEnvironmentLight | undefined,
  ): ResolvedPrefilteredEnvironment | undefined;
  studioSpecular(): StudioEnvironmentSpecularResource | undefined;
  wakeDurablePressure(): boolean;
}

export type LazyImageBasedLightingFeatureOptions = ImageBasedLightingFeatureOptions & {
  readonly active: () => boolean;
  readonly decodedTextureSources: DecodedTextureSourceLifetime;
};

/** Root-facing feature boundary, including synchronous decoded-source publication. */
export interface ImageBasedLightingRootFeature extends ImageBasedLightingFeature {
  settleSpecularImage(
    specular: SurfaceImageBasedLightSpecular,
    key: string,
    image: LoadedTextureSource,
  ): void;
}
