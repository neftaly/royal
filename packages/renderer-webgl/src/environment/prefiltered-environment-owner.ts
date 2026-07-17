import type { PrefilteredEnvironmentLight } from "@royal/renderer-core";
import {
  parseRoyalEnvironmentKtx1,
  type PreparedRoyalEnvironment,
  type RoyalEnvironmentMetadata,
} from "./royal-environment-ktx1";
import {
  ensurePrefilteredEnvironmentSpecularTexture,
  releasePrefilteredEnvironmentSpecularTexture,
  type IblTextureArena,
} from "../webgl/ibl-texture-arena";

export interface ResolvedPrefilteredEnvironment {
  readonly coefficients: RoyalEnvironmentMetadata["sh"];
  readonly specular?: {
    readonly key: string;
    readonly mipCount: number;
    readonly texture: WebGLTexture;
  };
}

type ActiveEnvironment = {
  readonly controller: AbortController;
  failure?: unknown;
  readonly key: string;
  prepared?: PreparedRoyalEnvironment;
  resolved?: ResolvedPrefilteredEnvironment;
};

export interface PrefilteredEnvironmentOwnerOptions {
  readonly diagnostic: (message: string, key: string) => void;
  readonly invalidate: () => void;
  readonly textures: IblTextureArena;
}

export const prefilteredEnvironmentKey = (
  environment: PrefilteredEnvironmentLight,
): string => JSON.stringify([
  "royal-prefiltered-environment-v1",
  environment.src,
  environment.version === undefined
    ? null
    : [typeof environment.version, String(environment.version)],
]);

const failureMessage = (failure: unknown): string => failure instanceof Error
  ? failure.message
  : typeof failure === "string" ? failure : "unknown environment loading error";

/** Imperative transport and lifetime shell around the pure pinned-artifact parser. */
export class PrefilteredEnvironmentOwner {
  #active: ActiveEnvironment | undefined;
  readonly #options: PrefilteredEnvironmentOwnerOptions;

  constructor(options: PrefilteredEnvironmentOwnerOptions) {
    this.#options = options;
  }

  resolve(
    environment: PrefilteredEnvironmentLight | undefined,
  ): ResolvedPrefilteredEnvironment | undefined {
    if (environment === undefined) {
      this.release();
      return undefined;
    }
    const key = prefilteredEnvironmentKey(environment);
    if (this.#active?.key !== key) {
      this.release();
      const active: ActiveEnvironment = { controller: new AbortController(), key };
      this.#active = active;
      void this.#load(active, environment.src);
    }
    const active = this.#active!;
    if (active.prepared === undefined || active.failure !== undefined) return undefined;
    active.resolved ??= { coefficients: active.prepared.metadata.sh };
    const resource = ensurePrefilteredEnvironmentSpecularTexture(
      this.#options.textures,
      key,
      active.prepared,
    );
    if (resource.unsupportedMessage !== undefined) {
      this.#options.diagnostic(
        resource.unsupportedMessage,
        `prefiltered-environment-unsupported:${key}`,
      );
      return active.resolved;
    }
    if (resource.uploadError !== undefined) {
      this.#options.diagnostic(
        `Prefiltered environment upload failed: ${failureMessage(resource.uploadError)}`,
        `prefiltered-environment-upload:${key}`,
      );
      return active.resolved;
    }
    if (!resource.uploaded) {
      if (active.resolved.specular !== undefined) {
        active.resolved = { coefficients: active.prepared.metadata.sh };
      }
      return active.resolved;
    }
    if (
      active.resolved.specular?.texture !== resource.texture
      || active.resolved.specular.mipCount !== resource.mipCount
    ) {
      active.resolved = {
        coefficients: active.prepared.metadata.sh,
        specular: { key, mipCount: resource.mipCount, texture: resource.texture },
      };
    }
    return active.resolved;
  }

  release(): void {
    const active = this.#active;
    if (active === undefined) return;
    this.#active = undefined;
    active.controller.abort();
    releasePrefilteredEnvironmentSpecularTexture(this.#options.textures, active.key);
  }

  async #load(active: ActiveEnvironment, src: string): Promise<void> {
    try {
      const response = await fetch(src, { signal: active.controller.signal });
      if (!response.ok) {
        throw new Error(`request failed with HTTP ${response.status} ${response.statusText}`.trim());
      }
      const prepared = parseRoyalEnvironmentKtx1(await response.arrayBuffer());
      if (this.#active !== active) return;
      active.prepared = prepared;
      this.#options.invalidate();
    } catch (failure) {
      if (active.controller.signal.aborted || this.#active !== active) return;
      active.failure = failure;
      this.#options.diagnostic(
        `Prefiltered environment ${JSON.stringify(src)} failed to load: ${failureMessage(failure)}`,
        `prefiltered-environment-load:${active.key}`,
      );
      this.#options.invalidate();
    }
  }
}
