import { IblRuntimeOwner } from "./ibl-runtime-owner";
import type {
  ImageBasedLightingFeature,
  ImageBasedLightingFeatureOptions,
} from "./image-based-lighting-feature";
import type {
  SurfaceExecutionDiagnostic,
  SurfaceExecutionSignals,
} from "./webgl/surface-execution-arena";
import {
  bindSurfaceIbl,
  consumeIblTextureFrameWake,
  createIblTextureArena,
  drainIblTextureDiagnostics,
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
import type { WebGlTextureBindingShell } from "./webgl/texture-binding-shell";

/** Owns IBL GPU resources, surface binding, and lifecycle over retained sources. */
export class ImageBasedLightingFeatureOwner implements ImageBasedLightingFeature {
  readonly #diagnostics: SurfaceExecutionDiagnostic[] = [];
  readonly #recordDiagnostic = (message: string): void => {
    this.#diagnostics.push({ key: `ibl-governor:${message}`, message });
  };
  readonly #runtime: IblRuntimeOwner;
  readonly #signals: { diagnostics: readonly SurfaceExecutionDiagnostic[]; wakeRequested: boolean };
  readonly #textures: IblTextureArena;
  readonly #uniformBindings = new WeakSet<WebGLProgram>();

  constructor(options: ImageBasedLightingFeatureOptions) {
    this.#textures = createIblTextureArena(options.gl, options.governor);
    this.#signals = { diagnostics: this.#diagnostics, wakeRequested: false };
    this.#runtime = new IblRuntimeOwner({
      contextLifecycle: options.contextLifecycle,
      diagnostics: options.diagnostic,
      invalidate: options.invalidate,
      resourceArena: options.resourceArena,
      textures: this.#textures,
    });
  }

  bindSurface(
    bindings: WebGlTextureBindingShell,
    programs: ProgramArena,
    program: WebGLProgram,
    lightSet: SurfaceLightSet,
    specularTextureUnit: number | undefined,
    brdfLutTextureUnit: number | undefined,
    bindUniforms: boolean,
  ): void {
    const requiresUniforms = bindUniforms || !this.#uniformBindings.has(program);
    bindSurfaceIbl(
      this.#textures,
      programs,
      program,
      lightSet,
      specularTextureUnit,
      brdfLutTextureUnit,
      bindings,
      requiresUniforms,
    );
    this.#uniformBindings.add(program);
  }

  consumeSurfaceSignals(): SurfaceExecutionSignals {
    this.#diagnostics.length = 0;
    drainIblTextureDiagnostics(this.#textures, this.#recordDiagnostic);
    this.#signals.wakeRequested = consumeIblTextureFrameWake(this.#textures);
    return this.#signals;
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
