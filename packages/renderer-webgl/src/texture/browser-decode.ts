import type {
  DecodedImageTextureSource,
  DecodedTextureSource,
  TextureLeafSourceRef,
  TextureSourceRef,
} from "./asset-owner";
import { decodeBrowserImageElement } from "./browser-image-element";
import {
  encodedImageDimensionPrefixByteLength,
  readEncodedImageDimensions,
} from "./encoded-image-dimensions";
import { fitOrdinaryTextureStorage } from "./storage-fit";
import { RetainedFifo } from "../resource/retained-fifo";
import { createTextureAlphaMipChain } from "./alpha-mipmap-generation";
import type { AsyncPreparationScheduler } from "../resource/async-preparation-owner";

export type BrowserTextureDecoder = (
  asset: TextureSourceRef,
  signal: AbortSignal,
  maxStorageBytes?: number,
  retainAlpha?: boolean,
) => Promise<DecodedTextureSource>;

type PendingWork = {
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: unknown) => void;
  readonly run: () => Promise<unknown>;
  readonly signal: AbortSignal;
};

const aborted = (): DOMException => new DOMException("Texture decode was aborted", "AbortError");
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

  run<Value>(
    signal: AbortSignal,
    work: () => Promise<Value>,
  ): Promise<Value> {
    if (signal.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      this.#pending.enqueue({
        reject,
        resolve: (value) => resolve(value as Value),
        run: work,
        signal,
      });
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

const diagnosticLabel = (asset: TextureLeafSourceRef): string => {
  if (asset.kind === "embedded-asset") return asset.label;
  const source = asset.src.length <= 120 ? asset.src : `${asset.src.slice(0, 119)}…`;
  return `texture ${JSON.stringify(source)}`;
};

type TextureBlob = Readonly<{ blob: Blob; ktx2: boolean; svg: boolean }>;

const isKtx2MimeType = (mimeType: string): boolean =>
  mimeType.split(";", 1)[0]!.trim().toLowerCase() === "image/ktx2";

const isKtx2Uri = (uri: string): boolean => /\.ktx2(?:[?#]|$)/i.test(uri);

const isSvgMimeType = (mimeType: string): boolean =>
  mimeType.split(";", 1)[0]!.trim().toLowerCase() === "image/svg+xml";

const isSvgUri = (uri: string): boolean => /\.svg(?:[?#]|$)/i.test(uri);

const declaresKtx2 = (asset: TextureLeafSourceRef): boolean =>
  asset.sourceEncoding === "ktx2-etc2"
  || (asset.kind === "embedded-asset"
    ? isKtx2MimeType(asset.mimeType)
    : isKtx2Uri(asset.src));

const alphaMipmapsRequired = (asset: TextureLeafSourceRef): boolean =>
  (asset.sampler?.minFilter ?? "linear-mipmap-linear").includes("mipmap");

const readTextureBlob = async (
  asset: TextureLeafSourceRef,
  signal: AbortSignal,
): Promise<TextureBlob> => asset.kind === "embedded-asset"
    ? {
      blob: new Blob([asset.bytes as Uint8Array<ArrayBuffer>], { type: asset.mimeType }),
      ktx2: asset.sourceEncoding === "ktx2-etc2" || isKtx2MimeType(asset.mimeType),
      svg: asset.sourceEncoding === "svg" || isSvgMimeType(asset.mimeType),
    }
    : await (async () => {
      const response = await fetch(asset.src, { signal });
      if (!response.ok) {
        throw new Error(`${diagnosticLabel(asset)} fetch failed with HTTP ${response.status}`);
      }
      const blob = await response.blob();
      return {
        blob,
        ktx2: asset.sourceEncoding === "ktx2-etc2"
          || isKtx2Uri(asset.src)
          || isKtx2MimeType(blob.type),
        svg: asset.sourceEncoding === "svg" || isSvgUri(asset.src) || isSvgMimeType(blob.type),
      };
    })();

const decodeKtx2Texture = async (
  asset: TextureLeafSourceRef,
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
  let alpha: DecodedTextureSource["alpha"];
  if (retainAlpha) {
    const levels = texture.levels.map((level, index) => ({
      height: level.height,
      values: decodeKtx2Etc2Alpha(texture, index),
      width: level.width,
    }));
    const base = levels[0]!;
    alpha = alphaMipmapsRequired(asset) && levels.length > 1
      ? { ...base, levels }
      : base;
  }
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
  asset: TextureLeafSourceRef,
  blob: Blob,
  signal: AbortSignal,
  maxStorageBytes?: number,
  retainAlpha = false,
): Promise<DecodedTextureSource> => {
  if (signal.aborted) throw aborted();
  const decodeImageElement = async (): Promise<DecodedImageTextureSource> => {
    const decoded = await decodeBrowserImageElement(
      blob,
      signal,
      maxStorageBytes === undefined
        ? undefined
        : (width, height) => fitOrdinaryTextureStorage(width, height, maxStorageBytes),
    );
    return retainAlpha
      ? retainTextureAlpha(decoded, signal, alphaMipmapsRequired(asset))
      : decoded;
  };
  if (typeof globalThis.createImageBitmap !== "function") {
    return decodeImageElement();
  }
  const bitmapOptions = {
    colorSpaceConversion: "none",
    imageOrientation: "none",
    premultiplyAlpha: "none",
  } as const;
  let sourceDimensions: Readonly<{ height: number; width: number }> | undefined;
  let directFit: Readonly<{ height: number; width: number }> | undefined;
  const dimensionPrefixBytes = encodedImageDimensionPrefixByteLength(blob.type);
  if (
    maxStorageBytes !== undefined
    && maxStorageBytes >= 4
    && dimensionPrefixBytes !== undefined
  ) {
    const prefix = new Uint8Array(
      await blob.slice(0, dimensionPrefixBytes).arrayBuffer(),
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
          return await decodeImageElement();
        } catch (imageElementError) {
          throw new AggregateError(
            [error, fallbackError, imageElementError],
            `${diagnosticLabel(asset)} could not be decoded by browser bitmap or image-element paths`,
          );
        }
      }
    } else {
      try {
        return await decodeImageElement();
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
  return retainAlpha
    ? retainTextureAlpha(decoded, signal, alphaMipmapsRequired(asset))
    : decoded;
};

const retainTextureAlpha = (
  decoded: DecodedImageTextureSource,
  signal: AbortSignal,
  retainMipmaps: boolean,
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
    const base = {
      height: decoded.height,
      values,
      width: decoded.width,
    };
    return {
      ...decoded,
      alpha: retainMipmaps ? createTextureAlphaMipChain(base) : base,
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
 * Creates one root-local browser pipeline. The texture owner bounds complete
 * source lifecycles; this cold adapter separately bounds transport and
 * CPU-heavy bitmap decoding. An injected root scheduler governs transport
 * only, so fetched blobs do not occupy shared preparation slots while waiting
 * for browser decode.
 */
export const createBrowserTextureDecoder = (
  maxParallelDecodes = 4,
  etc2Available = true,
  retainSvgSource = false,
  scheduleTransport?: AsyncPreparationScheduler,
): BrowserTextureDecoder => {
  const decodes = new BrowserWorkQueue(maxParallelDecodes);
  const transports = new BrowserWorkQueue(8);
  const read = (
    asset: TextureLeafSourceRef,
    signal: AbortSignal,
  ): Promise<TextureBlob> => asset.kind === "embedded-asset"
    ? readTextureBlob(asset, signal)
    : transports.run(signal, () => scheduleTransport === undefined
      ? readTextureBlob(asset, signal)
      : scheduleTransport(signal, () => readTextureBlob(asset, signal)));
  const decodeLeaf = async (
    asset: TextureLeafSourceRef,
    signal: AbortSignal,
    maxStorageBytes: number | undefined,
    retainAlpha: boolean | undefined,
    fallback = false,
  ): Promise<DecodedTextureSource> => {
    if (!etc2Available && declaresKtx2(asset)) {
      throw new Error("Royal ETC2 KTX2 textures require WEBGL_compressed_texture_etc");
    }
    const { blob, ktx2, svg } = await read(asset, signal);
    if (fallback && svg) {
      throw new TypeError("Royal SVG texture fallback must be an ordinary raster or ETC2 source");
    }
    if (ktx2 && !etc2Available) {
      throw new Error("Royal ETC2 KTX2 textures require WEBGL_compressed_texture_etc");
    }
    const parsedSvg = svg
      ? await import("./svg-source").then(({ validateSvgTextureBlob }) =>
          validateSvgTextureBlob(blob, signal))
      : undefined;
    const decoded = await decodes.run(
      signal,
      () => ktx2
        ? decodeKtx2Texture(asset, blob, signal, maxStorageBytes, retainAlpha)
        : decodeTextureBlob(asset, blob, signal, maxStorageBytes, retainAlpha),
    );
    if (!retainSvgSource || !svg || decoded.kind === "ktx2-etc2") return decoded;
    return {
      ...decoded,
      encodedSvg: { blob, byteLength: blob.size, parsed: parsedSvg! },
    };
  };
  return async (asset, signal, maxStorageBytes, retainAlpha) => {
    try {
      return await decodeLeaf(asset, signal, maxStorageBytes, retainAlpha);
    } catch (error) {
      if (signal.aborted || asset.fallback === undefined) throw error;
      const value = error instanceof Error ? error.message : String(error);
      const fallbackReason = value.length <= 400 ? value : `${value.slice(0, 399)}…`;
      const decoded = await decodeLeaf(asset.fallback, signal, maxStorageBytes, retainAlpha, true);
      return { ...decoded, fallbackReason };
    }
  };
};
