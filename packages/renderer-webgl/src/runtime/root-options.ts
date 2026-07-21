import { DEFAULT_PERSISTENT_GPU_BYTE_BUDGET } from "../resource/persistent-gpu-budget";

/** Immutable creation policy for one renderer root and its WebGL2 context. */
export type RendererRootOptions = Readonly<{
  /** Requests an alpha channel when creating the WebGL2 context. @defaultValue `false` */
  alpha?: boolean;
  /** Requests browser antialiasing when creating the WebGL2 context. @defaultValue `false` */
  antialias?: boolean;
  /** Generates VT pages for eligible base-color raster/SVG assets. @defaultValue `false` */
  automaticVirtualTexturing?: boolean;
  /** Persistent GPU allocation ceiling in bytes. @defaultValue 256 MiB */
  persistentGpuByteBudget?: number;
}>;

/** Fully validated renderer creation policy with every default made explicit. */
export type ResolvedRendererRootOptions = Readonly<{
  alpha: boolean;
  antialias: boolean;
  automaticVirtualTexturing: boolean;
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
      key !== "alpha"
      && key !== "antialias"
      && key !== "automaticVirtualTexturing"
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
  if (
    options.automaticVirtualTexturing !== undefined
    && typeof options.automaticVirtualTexturing !== "boolean"
  ) {
    throw new TypeError("Royal renderer option automaticVirtualTexturing must be a boolean");
  }
  const persistentGpuByteBudget = options.persistentGpuByteBudget
    ?? DEFAULT_PERSISTENT_GPU_BYTE_BUDGET;
  if (!Number.isSafeInteger(persistentGpuByteBudget) || persistentGpuByteBudget < 1) {
    throw new RangeError("Royal renderer option persistentGpuByteBudget must be a positive safe integer");
  }
  return {
    alpha: options.alpha === true,
    antialias: options.antialias === true,
    automaticVirtualTexturing: options.automaticVirtualTexturing === true,
    persistentGpuByteBudget,
  };
};
