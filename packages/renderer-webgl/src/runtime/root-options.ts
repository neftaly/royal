import { DEFAULT_PERSISTENT_GPU_BYTE_BUDGET } from "../resource/persistent-gpu-budget";
import { DEFAULT_ASYNC_PREPARATION_JOB_LIMIT } from "../resource/async-preparation-owner";
import { DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME } from "../resource/frame-upload-budget";

export type CanvasRootOptions = Readonly<{
  /** Requests an alpha channel when creating the WebGL2 context. @defaultValue `true` */
  alpha?: boolean;
  /** Requests browser antialiasing when creating the WebGL2 context. @defaultValue `true` */
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

/** Validates immutable root options and returns their stable semantic identity. */
export const rendererRootOptionsSemanticKey = (options: CanvasRootOptions = {}): string => {
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
  return `${options.alpha === false ? 0 : 1}${options.antialias === false ? 0 : 1}${options.automaticVirtualTexturing === true ? 1 : 0}:${persistentGpuByteBudget}:${maxConcurrentPreparationJobs}:${ordinaryTextureUploadByteBudgetPerFrame}`;
};
