import { completeKtx2MipLevelCount, fitKtx2Etc2Storage, ktx2Etc2StorageBytes } from "./etc2-storage";
import { nativeTextureAvailable, validateNativeBaseDimensions } from "./native-storage";
import { selectAsyncPreparationLane, type AsyncPreparationScheduler } from "../resource/async-preparation-owner";
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
  preload(asset: TextureSourceRef, signal: AbortSignal, retainAlpha?: boolean): void;
  readAheadSnapshot(): StagedByteReadSnapshot;
}>;

type PendingWork = {
  readonly detail: boolean;
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
  #activeDetail = 0;
  #foregroundBurst = 0;
  readonly #detailLimit: number;
  readonly #limit: number;
  readonly #pending = new RetainedFifo<PendingWork>();
  readonly #pendingDetail = new RetainedFifo<PendingWork>();

  constructor(limit: number, detailLimit = limit) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("Royal browser texture decode concurrency must be a positive integer");
    }
    this.#limit = limit;
    this.#detailLimit = detailLimit;
  }

  run<Value>(
    signal: AbortSignal,
    work: () => Promise<Value>,
    detail = false,
  ): Promise<Value> {
    if (signal.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      const pending: PendingWork = {
        detail,
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
      (detail ? this.#pendingDetail : this.#pending).enqueue(pending);
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#active < this.#limit) {
      this.#discardCancelled(this.#pending);
      this.#discardCancelled(this.#pendingDetail);
      const selection = selectAsyncPreparationLane(
        this.#pending.peek() === undefined ? 0 : 1,
        this.#activeDetail < this.#detailLimit && this.#pendingDetail.peek() !== undefined ? 1 : 0,
        this.#foregroundBurst,
      );
      if (selection === undefined) return;
      this.#foregroundBurst = selection.foregroundBurst;
      const pending = (selection.lane === "detail" ? this.#pendingDetail : this.#pending).dequeue();
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
      if (pending.detail) this.#activeDetail += 1;
      void run().then(pending.resolve, pending.reject).finally(() => {
        this.#active -= 1;
        if (pending.detail) this.#activeDetail -= 1;
        this.#drain();
      });
    }
  }

  #discardCancelled(queue: RetainedFifo<PendingWork>): void {
    while (queue.peek()?.cancelled === true) queue.dequeue();
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
  if (asset.sourceEncoding?.startsWith("ktx2-") === true || isKtx2Uri(asset.src)) return "image/ktx2";
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
      ktx2: asset.sourceEncoding?.startsWith("ktx2-") === true || isKtx2MimeType(asset.mimeType),
      svg: asset.sourceEncoding === "svg" || isSvgMimeType(asset.mimeType),
    }
    : await (async () => {
      if (asset.gltfResource === true && readGltfTexture !== undefined) {
        const bytes = await readGltfTexture(asset as GltfTextureAssetRef, signal);
        return {
          blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: textureBlobType(asset) }),
          byteLength: bytes.byteLength,
          ktx2: asset.sourceEncoding?.startsWith("ktx2-") === true || isKtx2Uri(asset.src),
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
        ktx2: (asset.sourceEncoding?.startsWith("ktx2-") === true)
          || isKtx2Uri(asset.src)
          || isKtx2MimeType(blob.type),
        svg: asset.sourceEncoding === "svg" || isSvgUri(asset.src) || isSvgMimeType(blob.type),
      };
    })();

const waitForTextureContext = async (gl: WebGL2RenderingContext, signal: AbortSignal): Promise<void> => {
  while (gl.isContextLost()) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        gl.canvas.removeEventListener("webglcontextrestored", restored);
        signal.removeEventListener("abort", cancel);
      };
      const restored = (): void => { cleanup(); resolve(); };
      const cancel = (): void => { cleanup(); reject(aborted()); };
      gl.canvas.addEventListener("webglcontextrestored", restored, { once: true });
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      else if (!gl.isContextLost()) restored();
    });
  }
};

const emptyTextureBlocks = new Uint8Array(0);
// Separate closure scope: decoded sources must not retain parser/alpha temporaries.
const closeKtx2Levels = (levels: { blocks: Uint8Array }[]): (() => void) => () => {
  for (const level of levels) level.blocks = emptyTextureBlocks;
};

const decodeKtx2Texture = async (
  asset: TextureLeafSourceRef,
  blob: Blob,
  signal: AbortSignal,
  maxStorageBytes?: number,
  retainAlpha = false,
  etc2Available = true,
  gl?: WebGL2RenderingContext,
): Promise<DecodedTextureSource> => {
  if (signal.aborted) throw aborted();
  const { parseKtx2Native } = await import("./ktx2-native");
  const sourceTexture = parseKtx2Native(new Uint8Array(await blob.arrayBuffer()), asset.sourceEncoding === "ktx2-astc");
  if (signal.aborted) throw aborted();
  if (sourceTexture.format === "etc2-rgba" && !etc2Available) {
    throw new Error("Royal ETC2 KTX2 textures require WEBGL_compressed_texture_etc");
  }
  // Only native preparation waits; a lost context is not permanent lack of support.
  if (sourceTexture.format !== "etc2-rgba" && gl !== undefined) {
    for (;;) {
      if (signal.aborted) throw aborted();
      if (!gl.isContextLost()) {
        if (nativeTextureAvailable(gl, sourceTexture.format, sourceTexture.colorSpace)) break;
        if (!gl.isContextLost()) throw new Error(`Royal ${sourceTexture.format} texture is unsupported by this device`);
      }
      await waitForTextureContext(gl, signal);
    }
  }
  if (asset.sourceEncoding === "ktx2-etc2" && sourceTexture.format !== "etc2-rgba") {
    throw new TypeError("Royal KTX2 format does not match sourceEncoding");
  }
  if (asset.sourceEncoding === "ktx2-astc" && alphaMipmapsRequired(asset)
    && sourceTexture.levels.length !== completeKtx2MipLevelCount(sourceTexture.width, sourceTexture.height)) {
    throw new TypeError("EXT_texture_astc requires a full mip pyramid for mipmapped samplers");
  }
  const colorSpace = asset.colorSpace ?? "srgb";
  if (sourceTexture.colorSpace !== colorSpace) {
    throw new TypeError(
      `${diagnosticLabel(asset)} declares ${sourceTexture.colorSpace} ${sourceTexture.format === "etc2-rgba" ? "ETC2" : sourceTexture.format} storage but the asset requests ${colorSpace}`,
    );
  }
  const texture = maxStorageBytes === undefined
    ? sourceTexture
    : fitKtx2Etc2Storage(sourceTexture, maxStorageBytes);
  validateNativeBaseDimensions(texture.format, texture.width, texture.height);
  let alpha: DecodedTextureSource["alpha"];
  if (retainAlpha && sourceTexture.format !== "etc2-rgba") {
    throw new TypeError("Royal ASTC/BC textures do not support retained CPU alpha; use ETC2 or a raster source for alpha picking");
  }
  if (retainAlpha) {
    const { decodeKtx2Etc2Alpha } = await import("./ktx2-etc2");
    if (signal.aborted) throw aborted();
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
  const levels = texture.levels.map((level) => ({
    blocks: level.blocks,
    height: level.height,
    width: level.width,
  }));
  // Dropped mip views must not pin the full source allocation for a small preview.
  if (texture !== sourceTexture) {
    const blocks = new Uint8Array(ktx2Etc2StorageBytes(texture));
    let offset = 0;
    for (const level of levels) {
      blocks.set(level.blocks, offset);
      const end = offset + level.blocks.byteLength;
      level.blocks = blocks.subarray(offset, end);
      offset = end;
    }
  }
  return {
    close: closeKtx2Levels(levels),
    colorSpace,
    height: texture.height,
    ...(texture.format === "etc2-rgba"
      ? { kind: "ktx2-etc2" as const }
      : { kind: "ktx2-native" as const, format: texture.format }),
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
  readGltfTexture?: BrowserGltfTextureReader,
  onReadAheadChanged: () => void = () => undefined,
  scheduleSvgPreparation: AsyncPreparationScheduler = (_signal, prepare) => prepare(),
  gl?: WebGL2RenderingContext,
): BrowserTextureDecoder => {
  const now = (): number => performance.now();
  const decodes = new BrowserWorkQueue(maxParallelDecodes);
  // Keep transport capacity available for newly visible preview coverage.
  const transports = new BrowserWorkQueue(16, 4);
  const transport = async (
    asset: TextureLeafSourceRef,
    signal: AbortSignal,
    detail = false,
  ): Promise<TextureBlob> => {
    const queuedAt = now();
    let startedAt = queuedAt;
    const result = await transports.run(signal, () => {
      startedAt = now();
      return readTextureBlob(asset, signal, readGltfTexture);
    }, detail);
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
    detail = false,
  ): Promise<TextureBlob> => {
    if (asset.kind === "embedded-asset") {
      return readTextureBlob(asset, signal, readGltfTexture);
    }
    const prefetched = readAhead.take(asset);
    return prefetched === undefined ? transport(asset, signal, detail) : await prefetched;
  };
  const selectRaster = (asset: TextureLeafSourceRef, retainAlpha = false): TextureLeafSourceRef =>
    asset.astc !== undefined && !retainAlpha && gl !== undefined
      && nativeTextureAvailable(gl, "astc-6x6", asset.colorSpace ?? "srgb") ? asset.astc : asset;
  const decodeLeaf = async (
    asset: TextureLeafSourceRef,
    signal: AbortSignal,
    maxStorageBytes: number | undefined,
    retainAlpha: boolean | undefined,
    fallback = false,
  ): Promise<DecodedTextureSource> => {
    if ((asset.astc !== undefined || asset.sourceEncoding === "ktx2-astc") && gl !== undefined) {
      await waitForTextureContext(gl, signal);
      if (signal.aborted) throw aborted();
      asset = selectRaster(asset, retainAlpha);
      if (asset.sourceEncoding === "ktx2-astc" && (retainAlpha
        || !nativeTextureAvailable(gl, "astc-6x6", asset.colorSpace ?? "srgb"))) {
        throw new Error("Royal ASTC source requires native LDR support without retained CPU alpha");
      }
    }
    if (!etc2Available && asset.sourceEncoding === "ktx2-etc2") {
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
    const parsedSvg = svg
      ? await import("./svg-source").then(({ validateSvgTextureBlob }) =>
          validateSvgTextureBlob(blob, signal))
      : undefined;
    const decodeQueuedAt = now();
    let decodeStartedAt = decodeQueuedAt;
    const decoded = await decodes.run(signal, () => {
      decodeStartedAt = now();
      return ktx2
        ? decodeKtx2Texture(asset, blob, signal, maxStorageBytes, retainAlpha, etc2Available, gl)
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
    if (!svg || timed.kind !== undefined) return timed;
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
    if (asset.svgPreview && asset.fallback !== undefined) {
      let preview: DecodedTextureSource;
      try {
        preview = await decodeLeaf(asset.fallback, signal, Math.min(maxStorageBytes ?? Infinity, 128 * 128 * 4), retainAlpha, true);
      } catch (error) {
        if (signal.aborted) throw error;
        // A missing preview must not prevent a usable authoritative source.
        return decodeLeaf(asset, signal, maxStorageBytes, retainAlpha);
      }
      const lifetime = new AbortController();
      let pending: Promise<import("./source").EncodedSvgTextureSource> | undefined;
      const detail: {
        error?: string;
        encoded?: import("./source").EncodedSvgTextureSource;
        load(): Promise<import("./source").EncodedSvgTextureSource>;
      } = {
        load: () => pending ??= (async () => {
          const { blob, svg } = await read(asset, lifetime.signal, true);
          if (!svg) throw new TypeError("Royal SVG detail must contain an SVG source");
          const { validateSvgTextureBlob } = await import("./svg-source");
          const parsed = await scheduleSvgPreparation(
            lifetime.signal,
            () => validateSvgTextureBlob(blob, lifetime.signal),
          );
          if (lifetime.signal.aborted) throw aborted();
          const encoded = { blob, byteLength: blob.size, parsed };
          detail.encoded = encoded;
          return encoded;
        })().catch((error: unknown) => {
          detail.error = String(error instanceof Error ? error.message : error).slice(0, 400);
          throw error;
        }),
      };
      return {
        ...preview,
        close: () => {
          lifetime.abort();
          preview.close?.();
        },
        svgPreview: detail,
      };
    }
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
    preload: (asset: TextureSourceRef, signal: AbortSignal, retainAlpha = false): void => {
      if (signal.aborted || gl?.isContextLost()) return;
      const leaf = selectRaster(asset.svgPreview ? asset.fallback! : asset, retainAlpha);
      if (leaf.sourceEncoding === "ktx2-astc" && (retainAlpha || gl === undefined
        || !nativeTextureAvailable(gl, "astc-6x6", leaf.colorSpace ?? "srgb"))) return;
      readAhead.preload(leaf, signal);
    },
    readAheadSnapshot: (): StagedByteReadSnapshot => readAhead.snapshot(),
  };
};
