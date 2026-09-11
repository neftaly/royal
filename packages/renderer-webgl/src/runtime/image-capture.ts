import { rendererBeginImageCapture, type ImageCaptureCapableRoot, type RootImageCaptureHost } from "./image-capture-host";
import type { RendererRoot } from "./canvas-root";

/** Policy for a PNG capture of a stable, sized canvas scene. */
export type RendererImageCaptureOptions = Readonly<{
  /** Wait for admitted VT detail, or capture current coverage after source preparation. @defaultValue "settled" */
  refinement?: "settled" | "current";
  /** Cancels waiting and ignores any late encoding result; does not dispose the root. */
  signal?: AbortSignal;
  /** Deadline including preparation and encoding. @defaultValue 60000 */
  timeoutMs?: number;
}>;

export type RendererImageCapture = Readonly<{
  blob: Blob;
  timings: Readonly<{
    /** Waiting for source preparation, GPU publication and requested refinement. */
    preparationMs: number;
    /** CPU time submitting the final draw; not GPU execution time. */
    drawSubmissionMs: number;
    /** Canvas toBlob span, including readback, encoding and callback scheduling. */
    readbackAndEncodingMs: number;
    totalMs: number;
  }>;
}>;

export type ImageCaptureHost = Readonly<{
  assertCurrent(): void;
  prepare(): boolean;
  draw(): boolean;
  encode(callback: BlobCallback): void;
  now(): number;
  requestFrame(callback: () => void): void;
  subscribeLifecycle(callback: () => void): () => void;
}>;

/** Owns one bounded capture request; only live requests can publish an encoded image. */
export const captureImageRequest = (
  host: ImageCaptureHost,
  options: RendererImageCaptureOptions,
): Promise<RendererImageCapture> => new Promise((resolve, reject) => {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    reject(new TypeError("Royal capture options must be an object"));
    return;
  }
  for (const key of Reflect.ownKeys(options)) {
    if (key !== "signal" && key !== "timeoutMs" && key !== "refinement") {
      reject(new TypeError(`Royal capture options contain unsupported field ${String(key)}`));
      return;
    }
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    reject(new RangeError("Royal capture timeoutMs must be positive and at most 2147483647"));
    return;
  }
  if (options.refinement !== undefined && options.refinement !== "current" && options.refinement !== "settled") {
    reject(new TypeError("Royal capture refinement must be current or settled"));
    return;
  }
  const signal = options.signal;
  if (signal !== undefined && (signal === null || typeof signal !== "object"
    || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function"
    || typeof signal.removeEventListener !== "function")) {
    reject(new TypeError("Royal capture signal must be an AbortSignal"));
    return;
  }
  const start = host.now();
  let done = false;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = (): void => {
    done = true;
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    unsubscribe?.();
  };
  const fail = (error: unknown): void => {
    if (done) return;
    cleanup();
    reject(error);
  };
  const abort = (): void => fail(options.signal?.reason ?? new DOMException("Royal capture aborted", "AbortError"));
  const assertCurrent = (): void => {
    if (options.signal?.aborted) throw options.signal.reason;
    host.assertCurrent();
    if (host.now() - start >= timeoutMs) throw new Error("Royal image capture timed out");
  };
  const checkLifecycle = (): void => {
    try { assertCurrent(); } catch (error) { fail(error); }
  };
  const tick = (): void => {
    if (done) return;
    try {
      assertCurrent();
      if (!host.prepare()) {
        host.requestFrame(tick);
        return;
      }
      const preparedAt = host.now();
      if (!host.draw()) {
        host.requestFrame(tick);
        return;
      }
      assertCurrent();
      const drawnAt = host.now();
      // No await between the final draw and toBlob: the default buffer may clear.
      host.encode((blob) => {
        if (done) return;
        try {
          assertCurrent();
          if (blob === null) throw new Error("Royal could not encode the captured image");
          const encodedAt = host.now();
          cleanup();
          resolve({ blob, timings: {
            preparationMs: preparedAt - start,
            drawSubmissionMs: drawnAt - preparedAt,
            readbackAndEncodingMs: encodedAt - drawnAt,
            totalMs: encodedAt - start,
          } });
        } catch (error) { fail(error); }
      });
    } catch (error) { fail(error); }
  };
  try {
    assertCurrent();
    unsubscribe = host.subscribeLifecycle(checkLifecycle);
    options.signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => fail(new Error("Royal image capture timed out")), timeoutMs);
    tick();
  } catch (error) { fail(error); }
});


/** Cold capture readiness uses existing owners; no extra asset cache or scheduler. */
const captureRootImage = (host: RootImageCaptureHost, options: RendererImageCaptureOptions): Promise<RendererImageCapture> => {
  const { root } = host;
  const sceneInput = host.intent();
  const size = root.getSizeSnapshot();
  const generation = root.getLifecycleSnapshot().generation;
  if (sceneInput === null || size === null || size.backingWidth === 0 || size.backingHeight === 0) {
    throw new Error("Royal image capture requires a scene and nonzero canvas size");
  }
  let preparationAttempted = false;
  const assertCurrent = (): void => {
    const context = root.getLifecycleSnapshot();
    if (context.phase !== "active" || context.generation !== generation) {
      throw new Error("Royal image capture interrupted by context loss or disposal");
    }
    if (host.intent() !== sceneInput || root.getSizeSnapshot() !== size) {
      throw new Error("Royal scene or size changed during image capture");
    }
    if (host.hasExternalClock()) throw new Error("Royal image capture requires the canvas frame clock");
    if (host.hasOverlay()) throw new Error("Royal image capture does not yet support overlays");
    const failure = root.getSnapshot().lastFrameFailure;
    if (preparationAttempted && failure !== undefined) throw new Error(failure);
  };
  const ready = (): boolean => {
    const scene = host.scene();
    if (scene === null || host.pending()) return false;
    for (const node of scene.gltfNodes) {
      const asset = root.getGltfAssetSnapshot(node.asset);
      if (asset.status === "error") throw new Error(asset.error);
      if (asset.status === "degraded") throw new Error("Royal image capture requires successful glTF textures");
      if (asset.status !== "ready") return false;
    }
    const environment = scene.environment;
    if (environment?.source === "royal-prefiltered-v1") {
      const asset = host.environmentSnapshot(environment);
      if (asset.status === "error") throw new Error(asset.error);
      if (asset.status !== "ready") return false;
    }
    for (const texture of scene.textureAssets) {
      const asset = host.textureSnapshot(texture);
      if (asset.status === "error") throw new Error(asset.error);
      if (asset.status !== "ready") return false;
    }
    for (const texture of scene.virtualTextureAssets) {
      const asset = root.getVirtualTextureAssetSnapshot(texture);
      if (asset.status === "error" || asset.status === "unsupported") throw new Error(asset.error);
      if (asset.status !== "ready") return false;
    }
    const resources = root.getSnapshot().resources;
    if (resources.geometryUploads.pendingSurfaces > 0) return false;
    const vt = resources.virtualTextures;
    return vt.automaticWaiting === 0 && (options.refinement === "current" || (vt.pendingPages === 0 && vt.unresidentPages === 0));
  };
  return captureImageRequest({
    assertCurrent,
    prepare: () => {
      // A valid replacement may still carry the preceding frame's diagnostic.
      preparationAttempted = true;
      root.flushInvalidated();
      assertCurrent();
      return ready();
    },
    draw: () => {
      const frame = root.getSnapshot().frame;
      root.invalidate();
      root.flushInvalidated();
      if (root.getSnapshot().frame === frame) throw new Error("Royal image capture requires the canvas frame clock");
      return ready();
    },
    encode: (callback) => root.canvas.toBlob(callback, "image/png"),
    now: host.now,
    requestFrame: host.requestFrame,
    subscribeLifecycle: root.subscribeLifecycle,
  }, options);
};


/** Captures a stable canvas scene as PNG using its existing renderer root. */
export const captureImage = async (
  root: RendererRoot,
  options: RendererImageCaptureOptions = {},
): Promise<RendererImageCapture> => {
  const host = (root as RendererRoot & ImageCaptureCapableRoot)[rendererBeginImageCapture]();
  try {
    return await captureRootImage(host, options);
  } finally {
    host.release();
  }
};
