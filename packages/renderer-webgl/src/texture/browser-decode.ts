import type {
  DecodedImageTextureSource,
  DecodedTextureSource,
  GltfTextureAssetRef,
  TextureLeafSourceRef,
  TextureSourceRef,
} from "./source";
import { decodedTextureKey } from "./source";
import { decodeBrowserImageElement } from "./browser-image-element";
import {
  encodedImageDimensionPrefixByteLength,
  readEncodedImageDimensions,
} from "./encoded-image-dimensions";
import { fitOrdinaryTextureStorage } from "./storage-fit";
import { RetainedFifo } from "../resource/retained-fifo";
import {
  StagedByteReadOwner,
  type StagedByteReadLease,
  type StagedByteReadSnapshot,
} from "../resource/staged-byte-read-owner";
import { createTextureAlphaMipChain } from "./alpha-mipmap-generation";

export type BrowserTextureDecoder = Readonly<{
  decode(
    asset: TextureSourceRef,
    signal: AbortSignal,
    maxStorageBytes?: number,
    retainAlpha?: boolean,
  ): Promise<DecodedTextureSource>;
  preload(asset: TextureSourceRef, signal: AbortSignal): void;
  readAheadSnapshot(): StagedByteReadSnapshot;
}>;

type PendingWork = {
  cancel: () => void;
  cancelled: boolean;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: unknown) => void;
  run: (() => Promise<unknown>) | undefined;
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
      const pending: PendingWork = {
        cancel: () => undefined,
        cancelled: false,
        reject,
        resolve: (value) => resolve(value as Value),
        run: work,
        signal,
      };
      const cancel = (): void => {
        if (pending.cancelled || pending.run === undefined) return;
        pending.cancelled = true;
        pending.run = undefined;
        reject(aborted());
      };
      pending.cancel = cancel;
      signal.addEventListener("abort", cancel, { once: true });
      this.#pending.enqueue(pending);
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#active < this.#limit) {
      const pending = this.#pending.dequeue();
      if (pending === undefined) return;
      if (pending.cancelled) {
        pending.signal.removeEventListener("abort", pending.cancel);
        continue;
      }
      if (pending.signal.aborted || pending.run === undefined) {
        pending.run = undefined;
        pending.signal.removeEventListener("abort", pending.cancel);
        pending.reject(aborted());
        continue;
      }
      const run = pending.run;
      pending.run = undefined;
      pending.signal.removeEventListener("abort", pending.cancel);
      this.#active += 1;
      void run().then(pending.resolve, pending.reject).finally(() => {
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

type TextureBlob = Readonly<{
  blob: Blob;
  byteLength: number;
  ktx2: boolean;
  svg: boolean;
  transportDurationMs?: number;
  transportQueueDurationMs?: number;
}>;

type ReadAheadEntry = {
  readonly cancel: () => void;
  lease: StagedByteReadLease<TextureBlob> | undefined;
  readonly signal: AbortSignal;
  started: boolean;
  value: Promise<StagedByteReadLease<TextureBlob>> | undefined;
};

const ENCODED_READ_ACTIVE_LIMIT = 16;
const ENCODED_READ_SOURCE_LIMIT = 128;
const ENCODED_READ_STAGED_BYTE_THRESHOLD = 32 * 1024 * 1024;

/**
 * Lets encoded browser transport run ahead of bitmap decode without allowing
 * decoded pixels or GPU handoff to escape their independent owners.
 */
class BrowserTextureReadAhead {
  readonly #entries = new Map<string, ReadAheadEntry>();
  readonly #reads: StagedByteReadOwner<TextureBlob>;
  readonly #transport: (asset: TextureLeafSourceRef, signal: AbortSignal) => Promise<TextureBlob>;

  constructor(
    transport: (
      asset: TextureLeafSourceRef,
      signal: AbortSignal,
    ) => Promise<TextureBlob>,
    onChanged: () => void,
  ) {
    this.#transport = transport;
    this.#reads = new StagedByteReadOwner<TextureBlob>(
      ENCODED_READ_ACTIVE_LIMIT,
      ENCODED_READ_SOURCE_LIMIT,
      ENCODED_READ_STAGED_BYTE_THRESHOLD,
      onChanged,
    );
  }

  preload(asset: TextureSourceRef, signal: AbortSignal): void {
    if (signal.aborted || asset.kind === "embedded-asset") return;
    const key = decodedTextureKey(asset);
    if (this.#entries.has(key)) return;
    const controller = new AbortController();
    let entry!: ReadAheadEntry;
    const cancel = (): void => {
      signal.removeEventListener("abort", cancel);
      controller.abort();
      entry.lease?.release();
      if (this.#entries.get(key) === entry) this.#entries.delete(key);
    };
    entry = {
      cancel,
      lease: undefined,
      signal,
      started: false,
      value: undefined,
    };
    entry.value = this.#reads.read(controller.signal, () => {
      entry.started = true;
      return this.#transport(asset, controller.signal);
    }).then((lease) => {
      entry.lease = lease;
      if (signal.aborted) lease.release();
      return lease;
    });
    signal.addEventListener("abort", cancel, { once: true });
    this.#entries.set(key, entry);
    // Retain a settled failure until demand consumes it so a fast transport
    // failure cannot turn preload plus decode into two observable reads.
    void entry.value.catch(() => undefined);
  }

  take(asset: TextureLeafSourceRef): Promise<TextureBlob> | undefined {
    if (asset.kind === "embedded-asset") return undefined;
    const key = decodedTextureKey(asset);
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (!entry.started) {
      entry.cancel();
      return undefined;
    }
    this.#entries.delete(key);
    return entry.value!.then(
      (lease) => {
        entry.signal.removeEventListener("abort", entry.cancel);
        lease.release();
        return lease.bytes;
      },
      (error: unknown) => {
        entry.signal.removeEventListener("abort", entry.cancel);
        throw error;
      },
    );
  }

  snapshot(): StagedByteReadSnapshot {
    return this.#reads.snapshot();
  }
}

export type BrowserGltfTextureReader = (
  asset: GltfTextureAssetRef,
  signal: AbortSignal,
) => Promise<Uint8Array>;

const isKtx2MimeType = (mimeType: string): boolean =>
  mimeType.split(";", 1)[0]!.trim().toLowerCase() === "image/ktx2";

const isKtx2Uri = (uri: string): boolean => /\.ktx2(?:[?#]|$)/i.test(uri);

const isSvgMimeType = (mimeType: string): boolean =>
  mimeType.split(";", 1)[0]!.trim().toLowerCase() === "image/svg+xml";

const isAvifMimeType = (mimeType: string): boolean =>
  mimeType.split(";", 1)[0]!.trim().toLowerCase() === "image/avif";

const isSvgUri = (uri: string): boolean => /\.svg(?:[?#]|$)/i.test(uri);

const textureBlobType = (asset: TextureLeafSourceRef & Readonly<{ src: string }>): string => {
  if (asset.mimeType !== undefined) return asset.mimeType;
  if (asset.sourceEncoding === "ktx2-etc2" || isKtx2Uri(asset.src)) return "image/ktx2";
  if (asset.sourceEncoding === "svg" || isSvgUri(asset.src)) return "image/svg+xml";
  if (/\.avif(?:[?#]|$)/i.test(asset.src)) return "image/avif";
  if (/\.jpe?g(?:[?#]|$)/i.test(asset.src)) return "image/jpeg";
  if (/\.png(?:[?#]|$)/i.test(asset.src)) return "image/png";
  if (/\.webp(?:[?#]|$)/i.test(asset.src)) return "image/webp";
  return "";
};

const textureIsAvif = (asset: TextureLeafSourceRef, blob: Blob): boolean =>
  isAvifMimeType(blob.type)
  || (asset.kind === "embedded-asset"
    ? isAvifMimeType(asset.mimeType)
    : isAvifMimeType(textureBlobType(asset)));

const resizeAvifBitmap = (
  bitmap: ImageBitmap,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): DecodedImageTextureSource => {
  const canvas = globalThis.document?.createElement("canvas");
  if (canvas === undefined) {
    bitmap.close();
    throw new Error("Royal AVIF texture fitting requires a browser canvas");
  }
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (context === null) {
    bitmap.close();
    throw new Error("Royal AVIF texture fitting could not create a 2D canvas");
  }
  try {
    context.drawImage(bitmap, 0, 0, width, height);
  } catch (error) {
    bitmap.close();
    canvas.width = 1;
    canvas.height = 1;
    throw error;
  }
  bitmap.close();
  return {
    close: () => {
      canvas.width = 1;
      canvas.height = 1;
    },
    height,
    source: canvas,
    sourceHeight,
    sourceWidth,
    width,
  };
};

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
  readGltfTexture?: BrowserGltfTextureReader,
): Promise<TextureBlob> => asset.kind === "embedded-asset"
    ? {
      blob: new Blob([asset.bytes as Uint8Array<ArrayBuffer>], { type: asset.mimeType }),
      byteLength: asset.bytes.byteLength,
      ktx2: asset.sourceEncoding === "ktx2-etc2" || isKtx2MimeType(asset.mimeType),
      svg: asset.sourceEncoding === "svg" || isSvgMimeType(asset.mimeType),
    }
    : await (async () => {
      if (asset.gltfResource === true && readGltfTexture !== undefined) {
        const bytes = await readGltfTexture(asset as GltfTextureAssetRef, signal);
        return {
          blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: textureBlobType(asset) }),
          byteLength: bytes.byteLength,
          ktx2: asset.sourceEncoding === "ktx2-etc2" || isKtx2Uri(asset.src),
          svg: asset.sourceEncoding === "svg" || isSvgUri(asset.src),
        };
      }
      const response = await fetch(asset.src, { signal });
      if (!response.ok) {
        throw new Error(`${diagnosticLabel(asset)} fetch failed with HTTP ${response.status}`);
      }
      const blob = await response.blob();
      return {
        blob,
        byteLength: blob.size,
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
  imageElementOutput?: "canvas",
): Promise<DecodedTextureSource> => {
  if (signal.aborted) throw aborted();
  const avif = textureIsAvif(asset, blob);
  const decodeImageElement = async (): Promise<DecodedImageTextureSource> => {
    const decoded = await decodeBrowserImageElement(
      blob,
      signal,
      {
        fit: maxStorageBytes === undefined
          ? undefined
          : (width: number, height: number) =>
              fitOrdinaryTextureStorage(width, height, maxStorageBytes),
        output: imageElementOutput,
      },
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
        ) {
          // Firefox corrupts AVIF alpha when encoded bytes and resize options
          // are passed to createImageBitmap together. Native decode followed
          // by the explicit pixel resample below preserves the channel.
          if (!avif) directFit = fitted;
        }
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
      if (avif) {
        const decoded = resizeAvifBitmap(
          bitmap,
          fitted.width,
          fitted.height,
          sourceWidth,
          sourceHeight,
        );
        return retainAlpha
          ? retainTextureAlpha(decoded, signal, alphaMipmapsRequired(asset))
          : decoded;
      }
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
 * CPU-heavy bitmap decoding. Transport has its own authority because network
 * wait must not consume glTF/VT/environment CPU-preparation slots.
 */
export const createBrowserTextureDecoder = (
  maxParallelDecodes = 4,
  etc2Available = true,
  retainSvgSource = false,
  readGltfTexture?: BrowserGltfTextureReader,
  onReadAheadChanged: () => void = () => undefined,
): BrowserTextureDecoder => {
  const now = (): number => performance.now();
  const decodes = new BrowserWorkQueue(maxParallelDecodes);
  const transports = new BrowserWorkQueue(16);
  const transport = async (
    asset: TextureLeafSourceRef,
    signal: AbortSignal,
  ): Promise<TextureBlob> => {
    const queuedAt = now();
    let startedAt = queuedAt;
    const result = await transports.run(signal, () => {
      startedAt = now();
      return readTextureBlob(asset, signal, readGltfTexture);
    });
    const completedAt = now();
    return {
      ...result,
      transportDurationMs: Math.max(0, completedAt - startedAt),
      transportQueueDurationMs: Math.max(0, startedAt - queuedAt),
    };
  };
  const readAhead = new BrowserTextureReadAhead(transport, onReadAheadChanged);
  const read = async (
    asset: TextureLeafSourceRef,
    signal: AbortSignal,
  ): Promise<TextureBlob> => {
    if (asset.kind === "embedded-asset") {
      return readTextureBlob(asset, signal, readGltfTexture);
    }
    const prefetched = readAhead.take(asset);
    return prefetched === undefined ? transport(asset, signal) : await prefetched;
  };
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
    const {
      blob,
      ktx2,
      svg,
      transportDurationMs = 0,
      transportQueueDurationMs = 0,
    } = await read(asset, signal);
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
    const decodeQueuedAt = now();
    let decodeStartedAt = decodeQueuedAt;
    const decoded = await decodes.run(signal, () => {
      decodeStartedAt = now();
      return ktx2
        ? decodeKtx2Texture(asset, blob, signal, maxStorageBytes, retainAlpha)
        : decodeTextureBlob(
            asset,
            blob,
            signal,
            maxStorageBytes,
            retainAlpha,
            svg ? "canvas" : undefined,
          );
    });
    const decodeCompletedAt = now();
    const timed = {
      ...decoded,
      timings: {
        decodeDurationMs: Math.max(0, decodeCompletedAt - decodeStartedAt),
        decodeQueueDurationMs: Math.max(0, decodeStartedAt - decodeQueuedAt),
        transportDurationMs,
        transportQueueDurationMs,
      },
    };
    if (!retainSvgSource || !svg || timed.kind === "ktx2-etc2") return timed;
    return {
      ...timed,
      encodedSvg: { blob, byteLength: blob.size, parsed: parsedSvg! },
    };
  };
  const decode = async (
    asset: TextureSourceRef,
    signal: AbortSignal,
    maxStorageBytes?: number,
    retainAlpha?: boolean,
  ): Promise<DecodedTextureSource> => {
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
  return {
    decode,
    preload: (asset: TextureSourceRef, signal: AbortSignal): void =>
      readAhead.preload(asset, signal),
    readAheadSnapshot: (): StagedByteReadSnapshot => readAhead.snapshot(),
  };
};
