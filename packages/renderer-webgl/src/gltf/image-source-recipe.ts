import type { TextureContentKey } from "@royal/renderer-core";
import { loadHtmlImage } from "../texture/browser-image-loader";
import { closeDecodedTextureSource } from "../texture/decoded-source-lifetime";
import {
  abortError,
  resolveResourceUri,
} from "../resource-io";
import type { LoadedTextureSource } from "../texture/sources";
import { gltfImageLoadKey, type GltfImageKind } from "./image-keys";
import {
  dataUriMediaType,
  decodeDataUri,
  gltfBufferViewBytes,
} from "./io";
import type { GltfDocument, GltfImage } from "./schema";

type GltfBasisuCodecModule = typeof import("./codecs/basisu");

type BytesRecipe = {
  readonly bytes: ArrayBuffer;
  readonly contentKey?: TextureContentKey;
  readonly mimeType?: string;
};

export type GltfImageSourceRecipe = Readonly<{
  readonly key: string;
  readonly source:
    | ({ readonly kind: "basisu-bytes"; readonly codec: Promise<GltfBasisuCodecModule>; readonly label: string } & BytesRecipe)
    | { readonly codec: Promise<GltfBasisuCodecModule>; readonly kind: "basisu-uri"; readonly uri: string }
    | ({ readonly kind: "bitmap-bytes" } & BytesRecipe)
    | { readonly kind: "html-image"; readonly uri: string }
    | ({ readonly kind: "svg-bytes"; readonly label: string } & BytesRecipe)
    | { readonly kind: "svg-uri"; readonly uri: string };
}>;

export type LoadedGltfImageSource = Readonly<{
  readonly contentKey?: TextureContentKey;
  readonly image: LoadedTextureSource;
}>;

export type PreparedGltfImageSourceRecipe = Readonly<{
  readonly recipe: Readonly<{
    readonly key: string;
    readonly source: Exclude<
      GltfImageSourceRecipe["source"],
      { readonly kind: "basisu-uri" } | { readonly kind: "svg-uri" }
    >;
  }>;
  /** External bytes retained between transport and decode; embedded bytes remain recipe-owned. */
  readonly transportBytes: number;
}>;

/** True when preparation performs external byte transport before decode. */
export const gltfImageSourceRecipeRequiresTransport = (
  recipe: GltfImageSourceRecipe,
): boolean => {
  switch (recipe.source.kind) {
    case "basisu-uri":
    case "svg-uri": return true;
    case "html-image": return typeof globalThis.createImageBitmap === "function";
    default: return false;
  }
};

export const preparedGltfImageSourceRecipeWithoutTransport = (
  recipe: GltfImageSourceRecipe,
): PreparedGltfImageSourceRecipe => {
  const source = recipe.source;
  if (source.kind === "basisu-uri" || source.kind === "svg-uri") {
    throw new Error("glTF image recipe requires transport");
  }
  return { recipe: { key: recipe.key, source }, transportBytes: 0 };
};

const FNV_1A_32_OFFSET = 0x811c9dc5;
const FNV_1A_32_PRIME = 0x01000193;
const DJB2_XOR_OFFSET = 5381;
const textEncoder = new TextEncoder();

const hex32 = (value: number): string => value.toString(16).padStart(8, "0");

const hashBytes = (bytes: Uint8Array): string => {
  let fnv = FNV_1A_32_OFFSET;
  let djb = DJB2_XOR_OFFSET;
  for (const byte of bytes) {
    fnv ^= byte;
    fnv = Math.imul(fnv, FNV_1A_32_PRIME) >>> 0;
    djb = Math.imul(djb, 33) ^ byte;
    djb >>>= 0;
  }
  return `${hex32(fnv)}${hex32(djb)}`;
};

const byteContentKey = (bytes: ArrayBuffer, kind: string): TextureContentKey =>
  `royal-auto-bytes-v1:${kind}:${bytes.byteLength}:${hashBytes(new Uint8Array(bytes))}`;

const ownedBytes = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  image: GltfImage,
  cache: Map<string, ArrayBuffer>,
): ArrayBuffer | undefined => {
  if (image.uri?.startsWith("data:") === true) {
    const key = `uri:${image.uri}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const bytes = decodeDataUri(image.uri);
    cache.set(key, bytes);
    return bytes;
  }
  if (image.bufferView === undefined) return undefined;
  const key = `bufferView:${image.bufferView}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const bytes = gltfBufferViewBytes(document, buffers, image.bufferView);
  cache.set(key, bytes);
  return bytes;
};

const recipeSource = (
  src: string,
  image: GltfImage,
  kind: GltfImageKind,
  basisuCodec: Promise<GltfBasisuCodecModule> | undefined,
  bytes: ArrayBuffer | undefined,
): GltfImageSourceRecipe["source"] => {
  if (kind === "svg") {
    if (bytes !== undefined) {
      return {
        bytes,
        contentKey: byteContentKey(bytes, "image/svg+xml;source"),
        kind: "svg-bytes",
        label: image.uri === undefined
          ? `glTF SVG bufferView ${image.bufferView ?? ""}`
          : `glTF SVG data URI ${image.uri.slice(0, 48)}`,
        ...(image.mimeType === undefined ? {} : { mimeType: image.mimeType }),
      };
    }
    if (image.uri === undefined) throw new Error("glTF SVG image has no URI or bufferView");
    return { kind: "svg-uri", uri: resolveResourceUri(src, image.uri) };
  }
  if (kind === "basisu") {
    if (basisuCodec === undefined) throw new Error("glTF KHR_texture_basisu decoder was not requested");
    if (bytes !== undefined) {
      return {
        bytes,
        codec: basisuCodec,
        contentKey: byteContentKey(bytes, "KHR_texture_basisu"),
        kind: "basisu-bytes",
        label: image.uri ?? `bufferView ${image.bufferView ?? ""}`,
        ...(image.mimeType === undefined ? {} : { mimeType: image.mimeType }),
      };
    }
    if (image.uri === undefined) throw new Error("glTF KHR_texture_basisu image has no URI or bufferView");
    return { codec: basisuCodec, kind: "basisu-uri", uri: resolveResourceUri(src, image.uri) };
  }
  if (bytes !== undefined) {
    const mimeType = image.mimeType ?? (image.uri === undefined ? undefined : dataUriMediaType(image.uri));
    return {
      bytes,
      contentKey: byteContentKey(bytes, mimeType || "application/octet-stream"),
      kind: "bitmap-bytes",
      ...(mimeType === undefined ? {} : { mimeType }),
    };
  }
  if (image.uri === undefined) throw new Error("glTF image has no URI or bufferView");
  return { kind: "html-image", uri: resolveResourceUri(src, image.uri) };
};

export const createGltfImageSourceRecipes = (
  assetKey: string,
  src: string,
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  imageKeys: ReadonlySet<string>,
  basisuCodec: Promise<GltfBasisuCodecModule> | undefined,
): readonly GltfImageSourceRecipe[] => {
  const recipes: GltfImageSourceRecipe[] = [];
  const seen = new Set<string>();
  const byteCache = new Map<string, ArrayBuffer>();
  for (const [imageIndex, image] of (document.images ?? []).entries()) {
    let bytes: ArrayBuffer | undefined;
    for (const kind of ["image", "basisu", "svg"] as const) {
      const key = gltfImageLoadKey(assetKey, src, imageIndex, image, kind);
      if (key === undefined) continue;
      if (!imageKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      bytes ??= ownedBytes(document, buffers, image, byteCache);
      recipes.push({
        key,
        source: recipeSource(src, image, kind, basisuCodec, bytes),
      });
    }
  }
  return recipes;
};

export const gltfImageSourceRecipeBytes = (recipes: Iterable<GltfImageSourceRecipe>): number => {
  const buffers = new Set<ArrayBuffer>();
  for (const recipe of recipes) {
    if ("bytes" in recipe.source) buffers.add(recipe.source.bytes);
  }
  let bytes = 0;
  for (const buffer of buffers) bytes += buffer.byteLength;
  if (!Number.isSafeInteger(bytes)) throw new RangeError("glTF recipe byte overflow");
  return bytes;
};

const loadBitmap = (bytes: ArrayBuffer, mimeType: string | undefined, signal: AbortSignal): Promise<ImageBitmap> => {
  const createBitmap = globalThis.createImageBitmap;
  if (typeof createBitmap !== "function") {
    return Promise.reject(new Error("ImageBitmap decoding is unavailable for glTF bufferView image"));
  }
  return createBitmap(new Blob([bytes], { type: mimeType ?? "application/octet-stream" })).then((bitmap) => {
    if (!signal.aborted) return bitmap;
    bitmap.close();
    throw abortError();
  });
};

const fetchBytes = async (uri: string, signal: AbortSignal): Promise<Readonly<{
  bytes: ArrayBuffer;
  mimeType?: string;
}>> => {
  const response = await fetch(uri, { signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const bytes = await response.arrayBuffer();
  const mimeType = response.headers?.get("content-type")?.split(";", 1)[0]?.trim();
  return {
    bytes,
    ...(mimeType === undefined || mimeType === "" ? {} : { mimeType }),
  };
};

const decodedUnlessAborted = <T extends LoadedTextureSource>(image: T, signal: AbortSignal): T => {
  if (!signal.aborted) return image;
  closeDecodedTextureSource(image);
  throw abortError();
};

/** Transport shell: external bytes can overlap while CPU-heavy decode remains separately scheduled. */
export const prepareGltfImageSourceRecipe = async (
  recipe: GltfImageSourceRecipe,
  signal: AbortSignal,
): Promise<PreparedGltfImageSourceRecipe> => {
  const source = recipe.source;
  switch (source.kind) {
    case "html-image": {
      if (typeof globalThis.createImageBitmap !== "function") {
        return preparedGltfImageSourceRecipeWithoutTransport(recipe);
      }
      const loaded = await fetchBytes(source.uri, signal);
      return {
        recipe: {
          key: recipe.key,
          source: {
            bytes: loaded.bytes,
            kind: "bitmap-bytes",
            ...(loaded.mimeType === undefined ? {} : { mimeType: loaded.mimeType }),
          },
        },
        transportBytes: loaded.bytes.byteLength,
      };
    }
    case "svg-uri": {
      const loaded = await fetchBytes(source.uri, signal);
      return {
        recipe: {
          key: recipe.key,
          source: {
            bytes: loaded.bytes,
            kind: "svg-bytes",
            label: `SVG texture ${source.uri}`,
            mimeType: loaded.mimeType ?? "image/svg+xml",
          },
        },
        transportBytes: loaded.bytes.byteLength,
      };
    }
    case "basisu-uri": {
      const loaded = await fetchBytes(source.uri, signal);
      return {
        recipe: {
          key: recipe.key,
          source: {
            bytes: loaded.bytes,
            codec: source.codec,
            contentKey: byteContentKey(loaded.bytes, "KHR_texture_basisu"),
            kind: "basisu-bytes",
            label: source.uri,
            ...(loaded.mimeType === undefined ? {} : { mimeType: loaded.mimeType }),
          },
        },
        transportBytes: loaded.bytes.byteLength,
      };
    }
    default: return preparedGltfImageSourceRecipeWithoutTransport(recipe);
  }
};

/** Decode shell for an already transported recipe. */
export const decodePreparedGltfImageSourceRecipe = async (
  prepared: PreparedGltfImageSourceRecipe,
  signal: AbortSignal,
): Promise<LoadedGltfImageSource> => {
  const source = prepared.recipe.source;
  switch (source.kind) {
    case "html-image": return { image: await loadHtmlImage(source.uri, { signal }) };
    case "bitmap-bytes": return {
      ...(source.contentKey === undefined ? {} : { contentKey: source.contentKey }),
      image: await loadBitmap(source.bytes, source.mimeType, signal),
    };
    case "svg-bytes": {
      const { loadSvgTextureFromBytes } = await import("../texture/svg");
      const loaded = await loadSvgTextureFromBytes(source.bytes, source.label, signal);
      return {
        contentKey: byteContentKey(textEncoder.encode(loaded.text).buffer, "image/svg+xml;prepared"),
        image: loaded.image,
      };
    }
    case "basisu-bytes": {
      const codec = await source.codec;
      if (signal.aborted) throw abortError();
      return {
        contentKey: source.contentKey ?? byteContentKey(source.bytes, "KHR_texture_basisu"),
        image: decodedUnlessAborted(await codec.decodeGltfBasisuTexture(source.bytes, source.label), signal),
      };
    }
  }
};

export const loadGltfImageSourceRecipe = async (
  recipe: GltfImageSourceRecipe,
  signal: AbortSignal,
): Promise<LoadedGltfImageSource> => decodePreparedGltfImageSourceRecipe(
  await prepareGltfImageSourceRecipe(recipe, signal),
  signal,
);
