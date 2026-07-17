import type {
  ImageBasedLightingFeature,
  ImageBasedLightingRootFeature,
  LazyImageBasedLightingFeatureOptions,
} from "./image-based-lighting-feature";
import {
  resourceArenaSourceReferenceCount,
  retainResourceArenaIblSource,
} from "./resource-arena";
import type { LoadedTextureSource } from "./texture/sources";
import type { SurfaceExecutionSignals } from "./webgl/surface-execution-arena";
import type {
  IblSpecularTextureResource,
  StudioEnvironmentSpecularResource,
} from "./webgl/ibl-texture-arena";
import type { SurfaceImageBasedLightSpecular, SurfaceLightSet } from "./webgl/lights";
import type { ProgramArena } from "./webgl/program-arena";
import { bindSurfaceIblFallback } from "./webgl/surface-ibl-uniforms";
import type { WebGlTextureBindingShell } from "./webgl/texture-binding-shell";
import type { PrefilteredEnvironmentLight } from "@royal/renderer-core";
import type { ResolvedPrefilteredEnvironment } from "./environment/prefiltered-environment-owner";

type ImageBasedLightingFeatureModule = typeof import("./image-based-lighting-feature-owner");
const EMPTY_SIGNALS: SurfaceExecutionSignals = { diagnostics: [], wakeRequested: false };
let preloadedModule: ImageBasedLightingFeatureModule | undefined;

/** @internal Keeps IBL-focused tests deterministic without making the production entry eager. */
export const preloadImageBasedLightingFeature = async (): Promise<void> => {
  preloadedModule ??= await import("./image-based-lighting-feature-owner");
};

const failureMessage = (failure: unknown): string => failure instanceof Error
  ? failure.message
  : typeof failure === "string" ? failure : "Unknown image-based-lighting runtime failure";

/** Keeps diffuse IBL eager while loading specular GPU realization on first demand. */
export class LazyImageBasedLightingFeature implements ImageBasedLightingRootFeature {
  readonly #options: LazyImageBasedLightingFeatureOptions;
  readonly #pendingImages = new Map<string, SurfaceImageBasedLightSpecular>();
  #prefilteredEnvironment: PrefilteredEnvironmentLight | undefined;
  #failure: unknown;
  #feature: ImageBasedLightingFeature | undefined;
  #loading: Promise<void> | undefined;
  #module: ImageBasedLightingFeatureModule | undefined;
  #requested = false;

  constructor(options: LazyImageBasedLightingFeatureOptions) {
    this.#options = options;
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
    this.#activate();
    if (this.#feature !== undefined) {
      this.#feature.bindSurface(
        bindings,
        programs,
        program,
        lightSet,
        specularTextureUnit,
        brdfLutTextureUnit,
        bindUniforms,
      );
      return;
    }
    bindSurfaceIblFallback(programs, program, lightSet, bindUniforms);
  }

  consumeSurfaceSignals(): SurfaceExecutionSignals {
    return this.#feature?.consumeSurfaceSignals() ?? EMPTY_SIGNALS;
  }

  dropContext(): void {
    this.#feature?.dropContext();
  }

  ensureSpecular(specular: SurfaceImageBasedLightSpecular): IblSpecularTextureResource {
    this.#request();
    return this.#feature?.ensureSpecular(specular) ?? {
      imageSize: specular.imageSize,
      key: specular.key,
      mipCount: specular.imageLoadKeys.length,
      uploadCursor: 0,
      uploaded: false,
    };
  }

  prepareBrdfLut(): boolean {
    this.#request();
    return this.#feature?.prepareBrdfLut() ?? false;
  }

  releaseContextHandles(): void {
    this.#feature?.releaseContextHandles();
  }

  releaseSpecular(key: string): void {
    for (const [pendingKey, specular] of this.#pendingImages) {
      if (specular.key === key) this.#pendingImages.delete(pendingKey);
    }
    this.#feature?.releaseSpecular(key);
  }

  refreshRetainedSpecular(specular: SurfaceImageBasedLightSpecular): void {
    this.#request();
    this.#feature?.refreshRetainedSpecular(specular);
  }

  resolvePrefilteredEnvironment(
    environment: PrefilteredEnvironmentLight | undefined,
  ): ResolvedPrefilteredEnvironment | undefined {
    this.#prefilteredEnvironment = environment;
    if (environment !== undefined) this.#request();
    return this.#feature?.resolvePrefilteredEnvironment(environment);
  }

  settleSpecularImage(
    specular: SurfaceImageBasedLightSpecular,
    key: string,
    image: LoadedTextureSource,
  ): void {
    const previous = retainResourceArenaIblSource(
      this.#options.resourceArena,
      specular.key,
      key,
      image,
    );
    if (
      previous !== undefined
      && previous !== image
      && resourceArenaSourceReferenceCount(this.#options.resourceArena, previous) === 0
    ) this.#options.decodedTextureSources.closeOrdinary(previous);
    if (this.#feature !== undefined) {
      this.#feature.refreshRetainedSpecular(specular);
      return;
    }
    this.#pendingImages.set(`${specular.key}\0${key}`, specular);
    this.#request();
  }

  studioSpecular(): StudioEnvironmentSpecularResource | undefined {
    this.#request();
    return this.#feature?.studioSpecular();
  }

  wakeDurablePressure(): boolean {
    return this.#feature?.wakeDurablePressure() ?? false;
  }

  #activate(): void {
    this.#module ??= preloadedModule;
    if (
      this.#feature !== undefined
      || !this.#requested
      || this.#module === undefined
      || !this.#options.active()
      || this.#options.disposed()
    ) return;
    let feature: ImageBasedLightingFeature | undefined;
    try {
      feature = new this.#module.ImageBasedLightingFeatureOwner(this.#options);
      for (const [pendingKey, specular] of this.#pendingImages) {
        feature.refreshRetainedSpecular(specular);
        this.#pendingImages.delete(pendingKey);
      }
      if (this.#prefilteredEnvironment !== undefined) {
        feature.resolvePrefilteredEnvironment(this.#prefilteredEnvironment);
      }
      this.#feature = feature;
      this.#options.invalidate();
    } catch (error) {
      if (feature !== undefined) {
        try { feature.releaseContextHandles(); } catch { /* Retain the original activation failure. */ }
        try { feature.dropContext(); } catch { /* Retain the original activation failure. */ }
      }
      this.#fail(error);
    }
  }

  #fail(error: unknown): void {
    if (this.#failure !== undefined || this.#options.disposed()) return;
    this.#failure = error;
    this.#options.diagnostic(
      `Image-based-lighting runtime failed to load: ${failureMessage(error)}`,
      "image-based-lighting-runtime-load",
    );
    this.#options.invalidate();
  }

  #request(): void {
    this.#requested = true;
    this.#activate();
    if (
      this.#feature !== undefined
      || this.#failure !== undefined
      || this.#loading !== undefined
      || this.#options.disposed()
    ) return;
    if (preloadedModule !== undefined) {
      this.#module = preloadedModule;
      this.#activate();
      return;
    }
    this.#loading = import("./image-based-lighting-feature-owner")
      .then((module) => {
        preloadedModule = module;
        this.#module = module;
        this.#activate();
      })
      .catch((error: unknown) => this.#fail(error));
  }
}
