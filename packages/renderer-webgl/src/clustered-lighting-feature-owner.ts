import type {
  ClusteredLightingFeature,
  ClusteredLightingFeatureOptions,
} from "./clustered-lighting-feature";
import type { Mat4 } from "./math/mat4";
import {
  bindClusteredLights,
  clusteredLightTextureUnits,
  configureClusteredLightArena,
  createClusteredLightArena,
  dropClusteredLightContext,
  releaseClusteredLightContextHandles,
  type ClusteredLightArena,
  type ClusteredLightTextureUnits,
} from "./webgl/clustered-light-arena";
import type { SurfacePointLight, SurfaceSpotLight } from "./webgl/lights";
import type { ProgramArena } from "./webgl/program-arena";

/** Owns clustered-light CPU scratch, GPU resources, binding, and lifecycle. */
export class ClusteredLightingFeatureOwner implements ClusteredLightingFeature {
  readonly #arena: ClusteredLightArena;

  constructor(options: ClusteredLightingFeatureOptions) {
    this.#arena = createClusteredLightArena(options.gl, options.governor);
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
    bindClusteredLights(
      this.#arena,
      programs,
      program,
      lights,
      projection,
      view,
      width,
      height,
      frame,
    );
  }

  configure(maxTextureImageUnits: number, maxTextureSize: number): void {
    configureClusteredLightArena(this.#arena, maxTextureImageUnits, maxTextureSize);
  }

  dropContext(): void {
    dropClusteredLightContext(this.#arena);
  }

  prepare(): boolean {
    return true;
  }

  releaseContextHandles(): void {
    releaseClusteredLightContextHandles(this.#arena);
  }

  textureUnits(): ClusteredLightTextureUnits {
    return clusteredLightTextureUnits(this.#arena);
  }
}
