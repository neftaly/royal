import { DEFAULT_PERSISTENT_GPU_BYTE_BUDGET } from "../resource/persistent-gpu-budget";
import { DEFAULT_ASYNC_PREPARATION_JOB_LIMIT } from "../resource/async-preparation-owner";
import { DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME } from "../resource/frame-upload-budget";

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
  /** Root-wide concurrent asynchronous asset-preparation ceiling. @defaultValue `8` */
  maxConcurrentPreparationJobs?: number;
  /** Ordinary-texture upload traffic admitted per rendered frame. @defaultValue 4 MiB */
  ordinaryTextureUploadByteBudgetPerFrame?: number;
}>;

/** Fully validated renderer creation policy with every default made explicit. */
export type ResolvedRendererRootOptions = Readonly<{
  alpha: boolean;
  antialias: boolean;
  automaticVirtualTexturing: boolean;
  persistentGpuByteBudget: number;
  maxConcurrentPreparationJobs: number;
  ordinaryTextureUploadByteBudgetPerFrame: number;
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
      && key !== "maxConcurrentPreparationJobs"
      && key !== "ordinaryTextureUploadByteBudgetPerFrame"
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
  const maxConcurrentPreparationJobs = options.maxConcurrentPreparationJobs
    ?? DEFAULT_ASYNC_PREPARATION_JOB_LIMIT;
  if (!Number.isSafeInteger(maxConcurrentPreparationJobs) || maxConcurrentPreparationJobs < 1) {
    throw new RangeError(
      "Royal renderer option maxConcurrentPreparationJobs must be a positive safe integer",
    );
  }
  const ordinaryTextureUploadByteBudgetPerFrame = options.ordinaryTextureUploadByteBudgetPerFrame
    ?? DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME;
  if (
    !Number.isSafeInteger(ordinaryTextureUploadByteBudgetPerFrame)
    || ordinaryTextureUploadByteBudgetPerFrame < 1
  ) {
    throw new RangeError(
      "Royal renderer option ordinaryTextureUploadByteBudgetPerFrame must be a positive safe integer",
    );
  }
  return {
    alpha: options.alpha === true,
    antialias: options.antialias === true,
    automaticVirtualTexturing: options.automaticVirtualTexturing === true,
    maxConcurrentPreparationJobs,
    ordinaryTextureUploadByteBudgetPerFrame,
    persistentGpuByteBudget,
  };
};
