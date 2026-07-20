import type {
  DecodedImageTextureSource,
  DecodedTextureSource,
  TextureSourceRef,
} from "./asset-owner";
import { decodeBrowserImageElement } from "./browser-image-element";
import { readEncodedImageDimensions } from "./encoded-image-dimensions";
import { fitOrdinaryTextureStorage } from "./storage-fit";
import { RetainedFifo } from "../resource/retained-fifo";

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
const IMAGE_HEADER_PREFIX_BYTES = 128 * 1024;

const mayContainDimensionHint = (blob: Blob): boolean => {
  const type = blob.type.split(";", 1)[0]!.trim().toLowerCase();
  return type.length === 0
    || type === "image/avif"
    || type === "image/jpeg"
    || type === "image/png"
    || type === "image/webp";
};

/** Bounds one asynchronous texture-work stage without coupling it to asset ownership. */
class BrowserWorkQueue {
  #active = 0;
  readonly #limit: number;
  readonly #pending = new RetainedFifo<PendingWork>();

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
      this.#pending.enqueue({ reject, resolve, run: decode, signal });
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#active < this.#limit) {
      const pending = this.#pending.dequeue();
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

type TextureBlob = Readonly<{ blob: Blob; ktx2: boolean }>;

const isKtx2MimeType = (mimeType: string): boolean =>
  mimeType.split(";", 1)[0]!.trim().toLowerCase() === "image/ktx2";

const isKtx2Uri = (uri: string): boolean => /\.ktx2(?:[?#]|$)/i.test(uri);

const readTextureBlob = async (
  asset: TextureSourceRef,
  signal: AbortSignal,
): Promise<TextureBlob> => asset.kind === "embedded-asset"
    ? {
      blob: new Blob([asset.bytes as Uint8Array<ArrayBuffer>], { type: asset.mimeType }),
      ktx2: false,
    }
    : await (async () => {
      const response = await fetch(asset.src, { signal });
      if (!response.ok) {
        throw new Error(`${diagnosticLabel(asset)} fetch failed with HTTP ${response.status}`);
      }
      const blob = await response.blob();
      return {
        blob,
        ktx2: isKtx2Uri(asset.src) || isKtx2MimeType(blob.type),
      };
    })();

const decodeKtx2Texture = async (
  asset: TextureSourceRef,
  blob: Blob,
  signal: AbortSignal,
  maxStorageBytes?: number,
  retainAlpha = false,
): Promise<DecodedTextureSource> => {
  if (signal.aborted) throw aborted();
  const {
    decodeKtx2Etc2Alpha,
    fitKtx2Etc2Storage,
    parseKtx2Etc2,
  } = await import("./ktx2-etc2");
  if (signal.aborted) throw aborted();
  const sourceTexture = parseKtx2Etc2(new Uint8Array(await blob.arrayBuffer()));
  if (signal.aborted) throw aborted();
  const colorSpace = asset.colorSpace ?? "srgb";
  if (sourceTexture.colorSpace !== colorSpace) {
    throw new TypeError(
      `${diagnosticLabel(asset)} declares ${sourceTexture.colorSpace} ETC2 storage but the asset requests ${colorSpace}`,
    );
  }
  const texture = maxStorageBytes === undefined
    ? sourceTexture
    : fitKtx2Etc2Storage(sourceTexture, maxStorageBytes);
  const alpha = retainAlpha ? {
    height: texture.height,
    values: decodeKtx2Etc2Alpha(texture),
    width: texture.width,
  } : undefined;
  const emptyBlocks = new Uint8Array(0);
  const levels = texture.levels.map((level) => ({
    blocks: level.blocks,
    height: level.height,
    width: level.width,
  }));
  let released = false;
  return {
    close: () => {
      if (released) return;
      released = true;
      for (const level of levels) level.blocks = emptyBlocks;
    },
    colorSpace,
    height: texture.height,
    kind: "ktx2-etc2",
    levels,
    ...(texture === sourceTexture ? {} : {
      sourceHeight: sourceTexture.height,
      sourceWidth: sourceTexture.width,
    }),
    ...(alpha === undefined ? {} : { alpha }),
    width: texture.width,
  };
};

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
  const bitmapOptions = {
    colorSpaceConversion: "none",
    imageOrientation: "none",
    premultiplyAlpha: "none",
  } as const;
  let sourceDimensions: Readonly<{ height: number; width: number }> | undefined;
  let directFit: Readonly<{ height: number; width: number }> | undefined;
  if (
    maxStorageBytes !== undefined
    && maxStorageBytes >= 4
    && mayContainDimensionHint(blob)
  ) {
    const prefix = new Uint8Array(
      await blob.slice(0, IMAGE_HEADER_PREFIX_BYTES).arrayBuffer(),
    );
    if (signal.aborted) throw aborted();
    const dimensions = readEncodedImageDimensions(prefix);
    if (dimensions !== undefined) {
      try {
        const fitted = fitOrdinaryTextureStorage(
          dimensions.width,
          dimensions.height,
          maxStorageBytes,
        );
        sourceDimensions = dimensions;
        if (
          fitted.width !== dimensions.width
          || fitted.height !== dimensions.height
        ) directFit = fitted;
      } catch {
        // A malformed size hint cannot replace browser format validation.
      }
    }
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await globalThis.createImageBitmap(blob, directFit === undefined
      ? bitmapOptions
      : {
          ...bitmapOptions,
          resizeHeight: directFit.height,
          resizeQuality: "high",
          resizeWidth: directFit.width,
        });
  } catch (error) {
    if (signal.aborted) throw aborted();
    if (directFit !== undefined) {
      try {
        bitmap = await globalThis.createImageBitmap(blob, bitmapOptions);
      } catch (fallbackError) {
        try {
          const decoded = await decodeBrowserImageElement(blob, signal);
          return retainAlpha ? retainTextureAlpha(decoded, signal) : decoded;
        } catch (imageElementError) {
          throw new AggregateError(
            [error, fallbackError, imageElementError],
            `${diagnosticLabel(asset)} could not be decoded by browser bitmap or image-element paths`,
          );
        }
      }
    } else {
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
  }
  if (signal.aborted) {
    bitmap.close();
    throw aborted();
  }
  if (bitmap.width < 1 || bitmap.height < 1) {
    bitmap.close();
    throw new Error(`${diagnosticLabel(asset)} decoded to an empty image`);
  }
  const sourceHeight = sourceDimensions?.height ?? bitmap.height;
  const sourceWidth = sourceDimensions?.width ?? bitmap.width;
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
  const decoded: DecodedImageTextureSource = {
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
  decoded: DecodedImageTextureSource,
  signal: AbortSignal,
): DecodedImageTextureSource => {
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
    const { blob, ktx2 } = await readTextureBlob(asset, signal);
    return decodes.run(
      signal,
      () => ktx2
        ? decodeKtx2Texture(asset, blob, signal, maxStorageBytes, retainAlpha)
        : decodeTextureBlob(asset, blob, signal, maxStorageBytes, retainAlpha),
    );
  });
};

/** Standalone adapter; renderer roots create their own queue through the factory. */
export const decodeTextureWithBrowser = createBrowserTextureDecoder();
