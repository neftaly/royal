import type {
  TextureAssetRef,
  TextureColorSpace,
  TextureContentKey,
  TextureVersion,
} from "@royal/renderer-core";
import type { DecodedTextureAlpha } from "./alpha-mipmap";
import type { Ktx2Etc2Level } from "./etc2-storage";
import type { ParsedSvgTextureSource } from "./svg-source";

export type DecodedImageTextureSource = Readonly<{
  alpha?: DecodedTextureAlpha;
  close?: () => void;
  /** Encoded vector authority retained only when another representation needs it. */
  encodedSvg?: EncodedSvgTextureSource;
  /** Bounded preferred-source failure when this image came from an authored fallback. */
  fallbackReason?: string;
  height: number;
  kind?: never;
  source: TexImageSource;
  sourceHeight?: number;
  sourceWidth?: number;
  width: number;
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
  fallbackReason?: string;
  height: number;
  kind: "ktx2-etc2";
  levels: readonly Ktx2Etc2Level[];
  sourceHeight?: number;
  sourceWidth?: number;
  width: number;
}>;

/** Canonical CPU upload source: a browser image or already-GPU-native ETC2 levels. */
export type DecodedTextureSource = DecodedImageTextureSource | DecodedKtx2Etc2TextureSource;

/** Explicit CPU-source claim used by optional representations such as automatic VT. */
export type DecodedTextureLease = Readonly<{
  release(): void;
  source: DecodedTextureSource;
}>;

export type TextureSourceEncoding = "ktx2-etc2" | "svg";

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

export type TextureLeafSourceRef =
  | (TextureAssetRef & Readonly<{ sourceEncoding?: TextureSourceEncoding }>)
  | EmbeddedTextureAssetRef;

/** Cold logical source recipe; a preferred SVG may recover to one ordinary leaf. */
export type TextureSourceRef = TextureLeafSourceRef & Readonly<{
  fallback?: TextureLeafSourceRef;
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
    && asset.sourceEncoding !== "svg"
  ) {
    throw new TypeError("Royal texture sourceEncoding must be ktx2-etc2 or svg when present");
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
  if (asset.fallback === undefined) return;
  if (asset.sourceEncoding !== "svg") {
    throw new TypeError("Royal texture fallback requires a preferred svg source");
  }
  validateLeafAsset(asset.fallback);
  if (asset.fallback.sourceEncoding === "svg") {
    throw new TypeError("Royal texture fallback must be an ordinary raster or ETC2 source");
  }
  if ((asset.fallback.colorSpace ?? "srgb") !== (asset.colorSpace ?? "srgb")) {
    throw new TypeError("Royal texture fallback must share the preferred source colorSpace");
  }
};

const decodedTextureLeafKey = (asset: TextureLeafSourceRef): unknown => {
  validateLeafAsset(asset);
  if (asset.kind === "embedded-asset") {
    return ["content", asset.contentKey, asset.sourceEncoding ?? asset.mimeType];
  }
  const content = asset.contentKey === undefined
    ? ["src", asset.src] as const
    : ["content", ...identityPart(asset.contentKey, "contentKey")] as const;
  return [
    content,
    identityPart(asset.version, "version"),
    asset.sourceEncoding ?? "auto",
  ];
};

/** Identity of logical decoded pixels; preferred/fallback alternates form one recipe. */
export const decodedTextureKey = (asset: TextureSourceRef): string => {
  validateAsset(asset);
  const preferred = decodedTextureLeafKey(asset);
  return JSON.stringify(asset.fallback === undefined
    ? preferred
    : ["preferred-with-fallback", preferred, decodedTextureLeafKey(asset.fallback)]);
};

/** GPU storage identity; one decoded image may be interpreted in both color spaces. */
export const textureStorageKey = (asset: TextureSourceRef): string =>
  JSON.stringify([decodedTextureKey(asset), asset.colorSpace ?? "srgb"]);
