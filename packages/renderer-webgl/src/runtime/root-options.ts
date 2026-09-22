import type { TextureInspection } from "../texture/inspection-policy";
import { DEFAULT_TEXTURE_ANISOTROPY } from "../texture/anisotropy";
import { DEFAULT_PERSISTENT_GPU_BYTE_BUDGET } from "../resource/persistent-gpu-budget";

/** Immutable creation policy for one renderer root and its WebGL2 context. */
export type RendererRootOptions = Readonly<{
  /** Requests an alpha channel when creating the WebGL2 context. @defaultValue `false` */
  alpha?: boolean;
  /** Optional asynchronous image policy, shared by all loaded material textures. */
  textureInspection?: TextureInspection;
  /** Maximum texture anisotropy, 1–16; 1 disables it. Capped by the device; unavailable extensions use 1. @defaultValue `16` */
  anisotropy?: number;
  /** Requests browser antialiasing when creating the WebGL2 context. @defaultValue `false` */
  antialias?: boolean;
  /** Persistent GPU allocation ceiling in bytes. @defaultValue 256 MiB */
  persistentGpuByteBudget?: number;
}>;

/** Fully validated renderer creation policy with every default made explicit. */
export type ResolvedRendererRootOptions = Readonly<{
  alpha: boolean;
  textureInspection?: TextureInspection;
  anisotropy: number;
  antialias: boolean;
  persistentGpuByteBudget: number;
}>;

/** Validates immutable renderer options and fills every documented default. */
export const resolveRendererRootOptions = (
  options: RendererRootOptions = {},
): ResolvedRendererRootOptions => {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new TypeError("Royal renderer options must be an object");
  }
  for (const key of Reflect.ownKeys(options)) {
    if (
      key !== "textureInspection"
      && key !== "alpha"
      && key !== "anisotropy"
      && key !== "antialias"
      && key !== "persistentGpuByteBudget"
    ) {
      throw new TypeError(`Royal renderer options contain unsupported field ${String(key)}`);
    }
  }
  if (options.alpha !== undefined && typeof options.alpha !== "boolean") {
    throw new TypeError("Royal renderer option alpha must be a boolean");
  }
  if (options.antialias !== undefined && typeof options.antialias !== "boolean") {
    throw new TypeError("Royal renderer option antialias must be a boolean");
  }
  const anisotropy = options.anisotropy === undefined ? DEFAULT_TEXTURE_ANISOTROPY : options.anisotropy;
  if (!Number.isInteger(anisotropy) || anisotropy < 1 || anisotropy > 16) {
    throw new RangeError("Royal renderer option anisotropy must be an integer from 1 to 16");
  }
  const persistentGpuByteBudget = options.persistentGpuByteBudget
    ?? DEFAULT_PERSISTENT_GPU_BYTE_BUDGET;
  if (!Number.isSafeInteger(persistentGpuByteBudget) || persistentGpuByteBudget < 1) {
    throw new RangeError("Royal renderer option persistentGpuByteBudget must be a positive safe integer");
  }
  const inspection = options.textureInspection;
  if (inspection !== undefined && (typeof inspection !== "object" || inspection === null
    || typeof inspection.key !== "string" || inspection.key.length === 0 || typeof inspection.allow !== "function")) {
    throw new TypeError("Royal textureInspection requires a non-empty key and an allow predicate");
  }
  return {
    ...(inspection === undefined ? {} : { textureInspection: { key: inspection.key, allow: inspection.allow } }),
    alpha: options.alpha === true,
    anisotropy,
    antialias: options.antialias === true,
    persistentGpuByteBudget,
  };
};
