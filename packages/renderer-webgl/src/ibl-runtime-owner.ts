import type { DecodedTextureSourceLifetime } from "./decoded-texture-source-lifetime";
import {
  resourceArenaIblSources,
  resourceArenaSourceReferenceCount,
  retainResourceArenaIblSource,
  type ResourceArena,
} from "./resource-arena";
import type { WebGlContextLifecycle } from "./root-types";
import type { LoadedTextureSource } from "./texture-sources";
import {
  consumeIblTextureDiagnostics,
  consumeIblTextureFrameWake,
  ensureGltfIblSpecularTexture,
  ensureStudioEnvironmentSpecularTexture,
  markGltfIblSpecularTextureDirty,
  type IblSpecularTextureResource,
  type IblTextureArena,
  type StudioEnvironmentSpecularResource,
} from "./webgl/ibl-texture-arena";
import type { SurfaceImageBasedLightSpecular } from "./webgl/lights";

const EMPTY_IBL_SOURCES: ReadonlyMap<string, LoadedTextureSource> = new Map();

type IblRuntimeOwnerOptions = {
  readonly contextLifecycle: () => WebGlContextLifecycle;
  readonly decodedTextureSources: DecodedTextureSourceLifetime;
  readonly diagnostics: (message: string, key: string) => void;
  readonly invalidate: () => void;
  readonly resourceArena: ResourceArena;
  readonly textures: IblTextureArena;
};

/** Owns IBL source publication, GPU realization, diagnostics, and frame wakes. */
export class IblRuntimeOwner {
  readonly #options: IblRuntimeOwnerOptions;

  constructor(options: IblRuntimeOwnerOptions) {
    this.#options = options;
  }

  ensureSpecular(specular: SurfaceImageBasedLightSpecular): IblSpecularTextureResource {
    try {
      const resource = ensureGltfIblSpecularTexture(
        this.#options.textures,
        specular,
        resourceArenaIblSources(this.#options.resourceArena, specular.key) ?? EMPTY_IBL_SOURCES,
      );
      if (resource.unsupportedMessage !== undefined) {
        this.#recordUnsupported(resource.unsupportedMessage);
      }
      if (resource.uploadError !== undefined) throw resource.uploadError;
      return resource;
    } finally {
      this.consumeSignals();
    }
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
    markGltfIblSpecularTextureDirty(this.#options.textures, specular.key);
    if (
      previous !== undefined
      && previous !== image
      && resourceArenaSourceReferenceCount(this.#options.resourceArena, previous) === 0
    ) this.#options.decodedTextureSources.closeOrdinary(previous);
    if (this.#options.contextLifecycle() !== "active") return;
    try {
      const resource = ensureGltfIblSpecularTexture(
        this.#options.textures,
        specular,
        resourceArenaIblSources(this.#options.resourceArena, specular.key) ?? EMPTY_IBL_SOURCES,
      );
      if (resource.unsupportedMessage !== undefined) {
        this.#recordUnsupported(resource.unsupportedMessage);
      }
      const uploadError = resource.uploadError;
      if (uploadError === undefined) return;
      const message = uploadError instanceof Error
        ? uploadError.message
        : typeof uploadError === "string" ? uploadError : "unknown driver error";
      this.#recordUploadFailure(message, specular.key);
    } catch (error) {
      this.#recordUploadFailure(error instanceof Error ? error.message : String(error), specular.key);
    } finally {
      this.consumeSignals();
    }
  }

  studioSpecular(): StudioEnvironmentSpecularResource | undefined {
    try {
      return ensureStudioEnvironmentSpecularTexture(this.#options.textures);
    } finally {
      this.consumeSignals();
    }
  }

  consumeSignals(): void {
    for (const message of consumeIblTextureDiagnostics(this.#options.textures)) {
      this.#options.diagnostics(message, `ibl-governor:${message}`);
    }
    if (consumeIblTextureFrameWake(this.#options.textures)) this.#options.invalidate();
  }

  #recordUnsupported(message: string): void {
    this.#options.diagnostics(message, `gltf-image-based-light:${message}`);
  }

  #recordUploadFailure(message: string, specularKey: string): void {
    this.#options.diagnostics(
      `glTF image-based light upload failed: ${message}`,
      `gltf-image-based-light-upload:${specularKey}`,
    );
  }
}
