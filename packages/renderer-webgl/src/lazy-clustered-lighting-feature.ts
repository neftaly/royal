import type {
  ClusteredLightingFeature,
  LazyClusteredLightingFeatureOptions,
} from "./clustered-lighting-feature";
import type { Mat4 } from "./math/mat4";
import type { ClusteredLightTextureUnits } from "./webgl/clustered-light-arena";
import type { SurfacePointLight, SurfaceSpotLight } from "./webgl/lights";
import { uniform1i, type ProgramArena } from "./webgl/program-arena";

type ClusteredLightingFeatureModule = typeof import("./clustered-lighting-feature-owner");

const UNAVAILABLE_TEXTURE_UNITS: ClusteredLightTextureUnits = {
  grid: -1,
  indices: -1,
  lights: -1,
};
let preloadedModule: ClusteredLightingFeatureModule | undefined;

/** @internal Keeps clustered-light-focused tests synchronous and deterministic. */
export const preloadClusteredLightingFeature = async (): Promise<void> => {
  preloadedModule ??= await import("./clustered-lighting-feature-owner");
};

const failureMessage = (failure: unknown): string => failure instanceof Error
  ? failure.message
  : typeof failure === "string" ? failure : "Unknown clustered-lighting runtime failure";

/** Loads Forward+ grid construction and GPU resources on first punctual-light demand. */
export class LazyClusteredLightingFeature implements ClusteredLightingFeature {
  #configuration: { maxTextureImageUnits: number; maxTextureSize: number } | undefined;
  #failure: unknown;
  #feature: ClusteredLightingFeature | undefined;
  #loading: Promise<void> | undefined;
  #module: ClusteredLightingFeatureModule | undefined;
  readonly #options: LazyClusteredLightingFeatureOptions;
  #requested = false;

  constructor(options: LazyClusteredLightingFeatureOptions) {
    this.#options = options;
  }

  bind(
    programs: ProgramArena,
    program: WebGLProgram,
    lights: readonly (SurfacePointLight | SurfaceSpotLight)[],
    projection: Mat4,
    view: Mat4,
    width: number,
    height: number,
    frame: number,
  ): void {
    this.#activate();
    if (this.#feature !== undefined) {
      this.#feature.bind(programs, program, lights, projection, view, width, height, frame);
      return;
    }
    uniform1i(programs, program, "u_useClusteredLights", 0);
  }

  configure(maxTextureImageUnits: number, maxTextureSize: number): void {
    this.#configuration = { maxTextureImageUnits, maxTextureSize };
    this.#feature?.configure(maxTextureImageUnits, maxTextureSize);
  }

  dropContext(): void {
    this.#feature?.dropContext();
  }

  prepare(lights: readonly (SurfacePointLight | SurfaceSpotLight)[]): boolean {
    if (lights.length === 0) return true;
    this.#request();
    return this.#feature?.prepare(lights) ?? false;
  }

  releaseContextHandles(): void {
    this.#feature?.releaseContextHandles();
  }

  textureUnits(): ClusteredLightTextureUnits {
    return this.#feature?.textureUnits() ?? UNAVAILABLE_TEXTURE_UNITS;
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
    let feature: ClusteredLightingFeature | undefined;
    try {
      feature = new this.#module.ClusteredLightingFeatureOwner(this.#options);
      const configuration = this.#configuration;
      if (configuration !== undefined) {
        feature.configure(configuration.maxTextureImageUnits, configuration.maxTextureSize);
      }
      this.#feature = feature;
      this.#options.invalidate();
    } catch (error) {
      if (feature !== undefined) {
        try { feature.releaseContextHandles(); } catch { /* Retain the activation failure. */ }
        try { feature.dropContext(); } catch { /* Retain the activation failure. */ }
      }
      this.#fail(error);
    }
  }

  #fail(error: unknown): void {
    if (this.#failure !== undefined) return;
    this.#failure = error;
    this.#options.diagnostic(
      `Clustered-lighting runtime failed to load: ${failureMessage(error)}`,
      "clustered-lighting-runtime-load",
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
    this.#loading = import("./clustered-lighting-feature-owner")
      .then((module) => {
        preloadedModule = module;
        this.#module = module;
        this.#activate();
      })
      .catch((error: unknown) => this.#fail(error));
  }
}
