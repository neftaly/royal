import { IblRuntimeOwner } from "./ibl-runtime-owner";
import type {
  ImageBasedLightingFeature,
  ImageBasedLightingFeatureOptions,
} from "./image-based-lighting-feature";
import type { SurfaceExecutionSignals } from "./webgl/surface-execution-arena";
import {
  bindSurfaceIbl,
  consumeIblTextureDiagnostics,
  consumeIblTextureFrameWake,
  createIblTextureArena,
  dropIblTextureContext,
  prepareSurfaceIblBrdfLut,
  releaseGltfIblSpecularTexture,
  releaseIblTextureContextHandles,
  wakeIblTextureDurablePressure,
  type IblSpecularTextureResource,
  type IblTextureArena,
  type StudioEnvironmentSpecularResource,
} from "./webgl/ibl-texture-arena";
import type { SurfaceImageBasedLightSpecular, SurfaceLightSet } from "./webgl/lights";
import type { ProgramArena } from "./webgl/program-arena";

/** Owns IBL GPU resources, surface binding, and lifecycle over retained sources. */
export class ImageBasedLightingFeatureOwner implements ImageBasedLightingFeature {
  readonly #runtime: IblRuntimeOwner;
  readonly #textures: IblTextureArena;

  constructor(options: ImageBasedLightingFeatureOptions) {
    this.#textures = createIblTextureArena(options.gl, options.governor);
    this.#runtime = new IblRuntimeOwner({
      contextLifecycle: options.contextLifecycle,
      diagnostics: options.diagnostic,
      invalidate: options.invalidate,
      resourceArena: options.resourceArena,
      textures: this.#textures,
    });
  }

  bindSurface(
    programs: ProgramArena,
    program: WebGLProgram,
    lightSet: SurfaceLightSet,
    specularTextureUnit: number | undefined,
    brdfLutTextureUnit: number | undefined,
  ): void {
    bindSurfaceIbl(
      this.#textures,
      programs,
      program,
      lightSet,
      specularTextureUnit,
      brdfLutTextureUnit,
    );
  }

  consumeSurfaceSignals(): SurfaceExecutionSignals {
    return {
      diagnostics: consumeIblTextureDiagnostics(this.#textures).map((message) => ({
        key: `ibl-governor:${message}`,
        message,
      })),
      wakeRequested: consumeIblTextureFrameWake(this.#textures),
    };
  }

  dropContext(): void {
    dropIblTextureContext(this.#textures);
  }

  ensureSpecular(specular: SurfaceImageBasedLightSpecular): IblSpecularTextureResource {
    return this.#runtime.ensureSpecular(specular);
  }

  prepareBrdfLut(): boolean {
    return prepareSurfaceIblBrdfLut(this.#textures);
  }

  releaseContextHandles(): void {
    releaseIblTextureContextHandles(this.#textures);
  }

  releaseSpecular(key: string): void {
    releaseGltfIblSpecularTexture(this.#textures, key);
  }

  refreshRetainedSpecular(specular: SurfaceImageBasedLightSpecular): void {
    this.#runtime.refreshRetainedSpecular(specular);
  }

  studioSpecular(): StudioEnvironmentSpecularResource | undefined {
    return this.#runtime.studioSpecular();
  }

  wakeDurablePressure(): boolean {
    return wakeIblTextureDurablePressure(this.#textures);
  }
}
