import type {
  TextureAssetRef,
  TextureColorSpace,
  TextureContentKey,
  TextureVersion,
} from "@royal/renderer-core";
import type { DecodedTextureAlpha } from "./alpha-mipmap";
import type { Ktx2Etc2Level } from "./etc2-storage";
import type { NativeTextureFormat } from "./native-storage";
import type { ParsedSvgTextureSource } from "./svg-source";

/** Cold stage attribution captured by the built-in browser texture decoder. */
export type TextureDecodeStageTimings = Readonly<{
  decodeDurationMs: number;
  decodeQueueDurationMs: number;
  transportDurationMs: number;
  transportQueueDurationMs: number;
}>;

export type DecodedImageTextureSource = Readonly<{
  alpha?: DecodedTextureAlpha;
  close?: () => void;
  /** Encoded vector authority retained only when another representation needs it. */
  encodedSvg?: EncodedSvgTextureSource;
  /** Base-color preview owns one lazy, shared authoritative source. */
  preview?: TexturePreviewSource;
  /** Bounded preferred-source failure when this image came from an authored fallback. */
  fallbackReason?: string;
  height: number;
  kind?: never;
  source: TexImageSource;
  sourceHeight?: number;
  sourceWidth?: number;
  /** @internal Renderer diagnostics; custom decoders may omit it. */
  timings?: TextureDecodeStageTimings;
  width: number;
}>;

export type TexturePreviewSource = Readonly<{
  error?: string;
  encoded?: EncodedSvgTextureSource;
  raster?: DecodedImageTextureSource;
  /** Full raster dimensions, separate from the native preview upload extent. */
  size?: Readonly<{ width: number; height: number }>;
  /** Planned bitmap reservation; retainedBytes includes an in-flight reservation. */
  rasterBytes?: number;
  retainedBytes?: number;
  load(): Promise<EncodedSvgTextureSource | DecodedImageTextureSource>;
}>;

export type EncodedSvgTextureSource = Readonly<{
  blob: Blob;
  byteLength: number;
  parsed: ParsedSvgTextureSource;
}>;

export type DecodedKtx2Etc2TextureSource = Readonly<{
  alpha?: DecodedTextureAlpha;
  close?: () => void;
  colorSpace: TextureColorSpace;
  preview?: TexturePreviewSource;
  fallbackReason?: string;
  height: number;
  kind: "ktx2-etc2";
  levels: readonly Ktx2Etc2Level[];
  sourceHeight?: number;
  sourceWidth?: number;
  /** @internal Renderer diagnostics; custom decoders may omit it. */
  timings?: TextureDecodeStageTimings;
  width: number;
}>;

export type DecodedKtx2NativeTextureSource = Omit<DecodedKtx2Etc2TextureSource, "kind"> & Readonly<{
  kind: "ktx2-native";
  format: Exclude<NativeTextureFormat, "etc2-rgba">;
}>;

/** Canonical CPU upload source: a browser image or already-GPU-native compressed levels. */
export type DecodedTextureSource = DecodedImageTextureSource | DecodedKtx2Etc2TextureSource | DecodedKtx2NativeTextureSource;

/** Explicit CPU-source claim used by optional representations such as automatic VT. */
export type DecodedTextureLease = Readonly<{
  release(): void;
  source: DecodedTextureSource;
}>;

export type TextureSourceEncoding = "ktx2-etc2" | "ktx2-native" | "ktx2-astc" | "svg";

export type GltfTextureAssetRef = TextureAssetRef & Readonly<{
  /** @internal Routes this source through the root's glTF resource reader. */
  gltfResource: true;
  /** @internal Exact format selected by a glTF texture-source extension. */
  mimeType?: "image/avif" | "image/webp" | "image/ktx2";
  sourceEncoding?: TextureSourceEncoding;
}>;

export type EmbeddedTextureAssetRef = Readonly<{
  bytes: Uint8Array;
  colorSpace?: "linear" | "srgb";
  contentKey: string;
  kind: "embedded-asset";
  label: string;
  mimeType: "image/avif" | "image/jpeg" | "image/ktx2" | "image/png" | "image/svg+xml" | "image/webp";
  sampler?: TextureAssetRef["sampler"];
  sourceEncoding?: TextureSourceEncoding;
}>;

export type TextureLeafSourceRef = (
  | (TextureAssetRef & Readonly<{
    gltfResource?: true;
    mimeType?: "image/avif" | "image/webp" | "image/ktx2";
    sourceEncoding?: TextureSourceEncoding;
  }>)
  | EmbeddedTextureAssetRef) & Readonly<{
  /** Optional hardware-native alternative; selected before any transport. */
  astc?: TextureLeafSourceRef;
}>;

/** Cold logical source recipe; a preferred SVG may recover to one ordinary leaf. */
export type TextureSourceRef = TextureLeafSourceRef & Readonly<{
  fallback?: TextureLeafSourceRef;
  /** Required SVG validates its authority before publishing a native preview. */
  svgPreview?: true | "required";
  /** Private explicit raster-preview recipe; ASTC alone remains a final source. */
  rasterPreview?: Readonly<{ width: number; height: number }>;
}>;

const identityPart = (
  value: TextureContentKey | TextureVersion | undefined,
  label: string,
): readonly [string, number | string | null] => {
  if (value === undefined) return ["unset", null];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Royal texture ${label} must be finite`);
    return ["number", value];
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Royal texture ${label} must be a non-empty string or finite number`);
  }
  return ["string", value];
};

const validateLeafAsset = (asset: TextureLeafSourceRef): void => {
  if (typeof asset !== "object" || asset === null || Array.isArray(asset)) {
    throw new TypeError("Royal texture asset identity must be an object");
  }
  if (
    asset.sourceEncoding !== undefined
    && asset.sourceEncoding !== "ktx2-etc2"
    && asset.sourceEncoding !== "ktx2-native"
    && asset.sourceEncoding !== "ktx2-astc"
    && asset.sourceEncoding !== "svg"
  ) {
    throw new TypeError("Royal texture sourceEncoding must be ktx2-etc2, ktx2-native, ktx2-astc or svg when present");
  }
  if (asset.astc !== undefined) {
    if (asset.astc.astc !== undefined || asset.astc.sourceEncoding !== "ktx2-astc"
      || (asset.astc.colorSpace ?? "srgb") !== (asset.colorSpace ?? "srgb")) {
      throw new TypeError("Royal ASTC alternative must be a same-color-space ASTC leaf");
    }
    validateLeafAsset(asset.astc);
  }
  if (asset.kind === "embedded-asset") {
    if (asset.contentKey.length === 0) {
      throw new TypeError("Royal embedded texture contentKey must not be empty");
    }
    if (asset.bytes.byteLength === 0) {
      throw new TypeError("Royal embedded texture bytes must not be empty");
    }
    return;
  }
  if (asset.kind !== "asset") throw new TypeError("Royal ordinary texture asset kind must be asset");
  if (typeof asset.src !== "string" || asset.src.length === 0) {
    throw new TypeError("Royal texture asset src must be a non-empty string");
  }
};

const validateAsset = (asset: TextureSourceRef): void => {
  validateLeafAsset(asset);
  if (asset.rasterPreview !== undefined) {
    const { width, height } = asset.rasterPreview;
    if (asset.astc === undefined || asset.sourceEncoding !== undefined
      || asset.svgPreview !== undefined || asset.fallback !== undefined
      || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384) {
      throw new TypeError("Royal raster preview requires a full raster, optional ASTC and dimensions from 1 to 16384");
    }
  }
  if (asset.svgPreview !== undefined && ((asset.svgPreview !== true && asset.svgPreview !== "required") || asset.fallback === undefined)) {
    throw new TypeError("Royal SVG preview requires an optional raster fallback");
  }
  if (asset.fallback === undefined) return;
  if (asset.sourceEncoding !== "svg") {
    throw new TypeError("Royal texture fallback requires a preferred svg source");
  }
  validateLeafAsset(asset.fallback);
  if (asset.fallback.sourceEncoding === "svg") {
    throw new TypeError("Royal texture fallback must be a raster or native compressed source");
  }
  if ((asset.fallback.colorSpace ?? "srgb") !== (asset.colorSpace ?? "srgb")) {
    throw new TypeError("Royal texture fallback must share the preferred source colorSpace");
  }
};

const decodedTextureLeafKey = (asset: TextureLeafSourceRef): unknown => {
  validateLeafAsset(asset);
  const leaf = asset.kind === "embedded-asset"
    ? ["content", asset.contentKey, asset.sourceEncoding ?? asset.mimeType]
    : [
      asset.contentKey === undefined
        ? ["src", asset.src]
        : ["content", ...identityPart(asset.contentKey, "contentKey")],
      identityPart(asset.version, "version"),
      asset.sourceEncoding ?? "auto",
    ];
  return asset.astc === undefined ? leaf : ["astc-alternative", leaf, decodedTextureLeafKey(asset.astc)];
};

/** Identity of logical decoded pixels; preferred/fallback alternates form one recipe. */
export const decodedTextureKey = (asset: TextureSourceRef): string => {
  validateAsset(asset);
  const leaf = decodedTextureLeafKey(asset);
  const preferred = asset.rasterPreview === undefined ? leaf
    : ["raster-preview", asset.rasterPreview.width, asset.rasterPreview.height, leaf];
  return JSON.stringify(asset.fallback === undefined
    ? preferred
    : [asset.svgPreview === "required" ? "required-svg-with-preview" : asset.svgPreview ? "svg-with-preview" : "preferred-with-fallback", preferred, decodedTextureLeafKey(asset.fallback)]);
};

/** GPU storage identity; one decoded image may be interpreted in both color spaces. */
export const textureStorageKey = (asset: TextureSourceRef): string =>
  JSON.stringify([decodedTextureKey(asset), asset.colorSpace ?? "srgb"]);
