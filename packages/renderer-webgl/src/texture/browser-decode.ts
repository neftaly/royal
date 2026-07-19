import type { DecodedTextureSource, TextureSourceRef } from "./asset-owner";
import { decodeBrowserImageElement } from "./browser-image-element";
import { fitOrdinaryTextureStorage } from "./storage-fit";

export type BrowserTextureDecoder = (
  asset: TextureSourceRef,
  signal: AbortSignal,
  maxStorageBytes?: number,
  retainAlpha?: boolean,
) => Promise<DecodedTextureSource>;

type PendingWork = {
  readonly reject: (error: unknown) => void;
  readonly resolve: (decoded: DecodedTextureSource) => void;
  readonly run: () => Promise<DecodedTextureSource>;
  readonly signal: AbortSignal;
};

const aborted = (): DOMException => new DOMException("Texture decode was aborted", "AbortError");

/** Bounds one asynchronous texture-work stage without coupling it to asset ownership. */
class BrowserWorkQueue {
  #active = 0;
  readonly #limit: number;
  readonly #pending: PendingWork[] = [];

  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("Royal browser texture decode concurrency must be a positive integer");
    }
    this.#limit = limit;
  }

  run(
    signal: AbortSignal,
    decode: () => Promise<DecodedTextureSource>,
  ): Promise<DecodedTextureSource> {
    if (signal.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      this.#pending.push({ reject, resolve, run: decode, signal });
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#active < this.#limit) {
      const pending = this.#pending.shift();
      if (pending === undefined) return;
      if (pending.signal.aborted) {
        pending.reject(aborted());
        continue;
      }
      this.#active += 1;
      void pending.run().then(pending.resolve, pending.reject).finally(() => {
        this.#active -= 1;
        this.#drain();
      });
    }
  }
}

const diagnosticLabel = (asset: TextureSourceRef): string => {
  if (asset.kind === "embedded-asset") return asset.label;
  const source = asset.src.length <= 120 ? asset.src : `${asset.src.slice(0, 119)}…`;
  return `texture ${JSON.stringify(source)}`;
};

const readTextureBlob = async (
  asset: TextureSourceRef,
  signal: AbortSignal,
): Promise<Blob> => asset.kind === "embedded-asset"
    ? new Blob([asset.bytes.slice().buffer as ArrayBuffer], { type: asset.mimeType })
    : await (async () => {
      const response = await fetch(asset.src, { signal });
      if (!response.ok) {
        throw new Error(`${diagnosticLabel(asset)} fetch failed with HTTP ${response.status}`);
      }
      return response.blob();
    })();

const decodeTextureBlob = async (
  asset: TextureSourceRef,
  blob: Blob,
  signal: AbortSignal,
  maxStorageBytes?: number,
  retainAlpha = false,
): Promise<DecodedTextureSource> => {
  if (signal.aborted) throw aborted();
  if (typeof globalThis.createImageBitmap !== "function") {
    throw new Error(`${diagnosticLabel(asset)} requires browser image decoding support`);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await globalThis.createImageBitmap(blob, {
      colorSpaceConversion: "none",
      imageOrientation: "none",
      premultiplyAlpha: "none",
    });
  } catch (error) {
    if (signal.aborted) throw aborted();
    try {
      const decoded = await decodeBrowserImageElement(blob, signal);
      return retainAlpha ? retainTextureAlpha(decoded, signal) : decoded;
    } catch (fallbackError) {
      throw new AggregateError(
        [error, fallbackError],
        `${diagnosticLabel(asset)} could not be decoded by browser bitmap or image-element paths`,
      );
    }
  }
  if (signal.aborted) {
    bitmap.close();
    throw aborted();
  }
  if (bitmap.width < 1 || bitmap.height < 1) {
    bitmap.close();
    throw new Error(`${diagnosticLabel(asset)} decoded to an empty image`);
  }
  const sourceHeight = bitmap.height;
  const sourceWidth = bitmap.width;
  if (maxStorageBytes !== undefined && maxStorageBytes >= 4) {
    const fitted = fitOrdinaryTextureStorage(bitmap.width, bitmap.height, maxStorageBytes);
    if (fitted.width !== bitmap.width || fitted.height !== bitmap.height) {
      try {
        const resized = await globalThis.createImageBitmap(bitmap, {
          colorSpaceConversion: "none",
          imageOrientation: "none",
          premultiplyAlpha: "none",
          resizeHeight: fitted.height,
          resizeQuality: "high",
          resizeWidth: fitted.width,
        });
        bitmap.close();
        bitmap = resized;
      } catch {
        // The persistent GPU authority still rejects an oversized fallback.
      }
    }
  }
  if (signal.aborted) {
    bitmap.close();
    throw aborted();
  }
  const decoded: DecodedTextureSource = {
    close: () => bitmap.close(),
    height: bitmap.height,
    source: bitmap,
    ...(bitmap.width === sourceWidth && bitmap.height === sourceHeight
      ? {}
      : { sourceHeight, sourceWidth }),
    width: bitmap.width,
  };
  return retainAlpha ? retainTextureAlpha(decoded, signal) : decoded;
};

const retainTextureAlpha = (
  decoded: DecodedTextureSource,
  signal: AbortSignal,
): DecodedTextureSource => {
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (signal.aborted) throw aborted();
    canvas = globalThis.document?.createElement("canvas");
    if (canvas === undefined) {
      throw new Error("Royal alpha-mask picking requires canvas pixel access");
    }
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("Royal alpha-mask picking could not create a 2D canvas");
    context.drawImage(decoded.source as CanvasImageSource, 0, 0, decoded.width, decoded.height);
    const rgba = context.getImageData(0, 0, decoded.width, decoded.height).data;
    const values = new Uint8Array(decoded.width * decoded.height);
    for (let source = 3, target = 0; target < values.length; source += 4, target += 1) {
      values[target] = rgba[source]!;
    }
    if (signal.aborted) throw aborted();
    return {
      ...decoded,
      alpha: { height: decoded.height, values, width: decoded.width },
    };
  } catch (error) {
    decoded.close?.();
    throw error;
  } finally {
    if (canvas !== undefined) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
};

/**
 * Creates one root-local browser decoder. Complete jobs and CPU-heavy bitmap
 * decodes have separate bounds so response blobs cannot pile up behind decode.
 */
export const createBrowserTextureDecoder = (
  maxParallelDecodes = 4,
  maxParallelJobs = 8,
): BrowserTextureDecoder => {
  if (maxParallelJobs < maxParallelDecodes) {
    throw new RangeError("Royal browser texture jobs must not be fewer than decodes");
  }
  const jobs = new BrowserWorkQueue(maxParallelJobs);
  const decodes = new BrowserWorkQueue(maxParallelDecodes);
  return (asset, signal, maxStorageBytes, retainAlpha) => jobs.run(signal, async () => {
    const blob = await readTextureBlob(asset, signal);
    return decodes.run(
      signal,
      () => decodeTextureBlob(asset, blob, signal, maxStorageBytes, retainAlpha),
    );
  });
};

/** Standalone adapter; renderer roots create their own queue through the factory. */
export const decodeTextureWithBrowser = createBrowserTextureDecoder();
