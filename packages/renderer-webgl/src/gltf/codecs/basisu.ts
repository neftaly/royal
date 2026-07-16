import { parse } from "@loaders.gl/core";
import { BasisLoader } from "@loaders.gl/textures";

type BasisTextureLevel = {
  readonly compressed?: boolean;
  readonly data?: ArrayBufferView;
  readonly format?: number;
  readonly height?: number;
  readonly shape?: string;
  readonly textureFormat?: string;
  readonly width?: number;
};

export type DecodedGltfBasisuLevel = {
  readonly data: Uint8Array;
  readonly height: number;
  readonly width: number;
};

export type DecodedGltfBasisuRgbaTexture = DecodedGltfBasisuLevel & {
  readonly kind: "rgba-texture";
  readonly levels?: readonly DecodedGltfBasisuLevel[];
};

export type DecodedGltfBasisuCompressedTexture = DecodedGltfBasisuLevel & {
  readonly format: number;
  readonly kind: "compressed-texture";
  readonly levels: readonly DecodedGltfBasisuLevel[];
  readonly srgbFormat: number;
};

export type DecodedGltfBasisuTexture =
  | DecodedGltfBasisuCompressedTexture
  | DecodedGltfBasisuRgbaTexture;

const GL_COMPRESSED_RGBA8_ETC2_EAC = 0x9278;
const GL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC = 0x9279;
// loaders.gl 4.4.x assigns its requested ETC2 RGBA transcode the SRGB8 enum.
// The textureFormat and Basis target remain ETC2 RGBA; canonicalize only this
// exact upstream alias before Royal publishes the correct WebGL2 enum.
const LOADERS_GL_ETC2_RGBA_ENUM_ALIAS = 0x9275;
const KTX2_IDENTIFIER = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A] as const;

type Ktx2LogicalDimensions = Readonly<{ height: number; width: number }>;

const ktx2LogicalDimensions = (bytes: ArrayBuffer): Ktx2LogicalDimensions | undefined => {
  if (bytes.byteLength < 28) return undefined;
  const identifier = new Uint8Array(bytes, 0, KTX2_IDENTIFIER.length);
  for (let index = 0; index < KTX2_IDENTIFIER.length; index += 1) {
    if (identifier[index] !== KTX2_IDENTIFIER[index]) return undefined;
  }
  const header = new DataView(bytes);
  const width = header.getUint32(20, true);
  const height = header.getUint32(24, true);
  return width > 0 && height > 0 ? { height, width } : undefined;
};

const logicalBasisLevel = (
  level: BasisTextureLevel,
  base: Ktx2LogicalDimensions | undefined,
  index: number,
  label: string,
): BasisTextureLevel => {
  if (base === undefined) return level;
  const divisor = 2 ** index;
  const width = Math.max(1, Math.floor(base.width / divisor));
  const height = Math.max(1, Math.floor(base.height / divisor));
  if (level.width === width && level.height === height) return level;
  if (level.width !== Math.max(4, width) || level.height !== Math.max(4, height)) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${index} dimensions disagree with its KTX2 header`);
  }
  return { ...level, height, width };
};

const ownedLevel = (data: Uint8Array, width: number, height: number): DecodedGltfBasisuLevel => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return { data: copy, height, width };
};

const validLevelDimensions = (
  level: BasisTextureLevel,
  label: string,
  levelIndex: number,
): readonly [width: number, height: number] => {
  const width = level.width;
  const height = level.height;
  if (
    typeof width !== "number"
    || !Number.isInteger(width)
    || width <= 0
    || typeof height !== "number"
    || !Number.isInteger(height)
    || height <= 0
  ) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} decoded invalid dimensions`);
  }
  return [width, height];
};

const validMipSizes = (
  levels: readonly DecodedGltfBasisuLevel[],
  label: string,
): void => {
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1]!;
    const level = levels[index]!;
    if (
      level.width !== Math.max(1, Math.floor(previous.width / 2))
      || level.height !== Math.max(1, Math.floor(previous.height / 2))
    ) throw new Error(`glTF KHR_texture_basisu ${label} has an invalid mip ${index} size`);
  }
};

const parsedBasisLevels = (parsed: unknown, label: string): readonly BasisTextureLevel[] => {
  const levels = basisTextureLevels(parsed);
  if (levels === undefined || levels.length === 0) {
    throw new Error(`glTF KHR_texture_basisu ${label} did not contain a texture level`);
  }
  return levels;
};

const etc2Level = (
  level: BasisTextureLevel,
  label: string,
  levelIndex: number,
): DecodedGltfBasisuLevel => {
  if (
    level.compressed !== true
    || (level.format !== GL_COMPRESSED_RGBA8_ETC2_EAC && level.format !== LOADERS_GL_ETC2_RGBA_ENUM_ALIAS)
    || level.textureFormat !== "etc2-rgba8unorm"
  ) throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} did not transcode to ETC2 RGBA`);
  const [width, height] = validLevelDimensions(level, label, levelIndex);
  const data = level.data;
  const expectedLength = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
  if (!(data instanceof Uint8Array) || !Number.isSafeInteger(expectedLength) || data.byteLength !== expectedLength) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} decoded an invalid ETC2 payload`);
  }
  return ownedLevel(data, width, height);
};

/** Validates and owns a deterministic ETC2 result returned by the Basis transcoder. */
export const decodedGltfBasisuEtc2 = (
  parsed: unknown,
  label: string,
  bytes?: ArrayBuffer,
): DecodedGltfBasisuCompressedTexture => {
  const dimensions = bytes === undefined ? undefined : ktx2LogicalDimensions(bytes);
  const levels = parsedBasisLevels(parsed, label).map((level, index) =>
    etc2Level(logicalBasisLevel(level, dimensions, index, label), label, index));
  validMipSizes(levels, label);
  const base = levels[0]!;
  return {
    data: base.data,
    format: GL_COMPRESSED_RGBA8_ETC2_EAC,
    height: base.height,
    kind: "compressed-texture",
    levels,
    srgbFormat: GL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC,
    width: base.width,
  };
};

export const decodeGltfBasisuTexture = async (
  bytes: ArrayBuffer,
  label: string,
): Promise<DecodedGltfBasisuTexture> => {
  try {
    return await decodeGltfBasisuEtc2Texture(bytes, label);
  } catch {
    // The universally safe RGBA path below also provides the actionable error.
  }
  const parsed = await parse(bytes, BasisLoader, {
    basis: { containerFormat: "auto", format: "rgba32" },
    worker: false,
  });
  return decodedGltfBasisuRgba(parsed, label, bytes);
};

/** Transcodes a page-addressable KTX2/Basis payload to WebGL2-core ETC2. */
export const decodeGltfBasisuEtc2Texture = async (
  bytes: ArrayBuffer,
  label: string,
): Promise<DecodedGltfBasisuCompressedTexture> => {
  const parsed = await parse(bytes, BasisLoader, {
    basis: { containerFormat: "auto", format: "etc2" },
    worker: false,
  });
  return decodedGltfBasisuEtc2(parsed, label, bytes);
};

/* RGBA remains the fallback when deterministic ETC2 transcoding is unavailable. */
const rgbaLevel = (
  level: BasisTextureLevel,
  label: string,
  levelIndex: number,
): DecodedGltfBasisuLevel => {
  if (level.compressed === true || level.textureFormat !== "rgba8unorm") {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} did not transcode to uncompressed RGBA8`);
  }
  const [width, height] = validLevelDimensions(level, label, levelIndex);
  const data = level.data;
  if (!(data instanceof Uint8Array)) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} did not decode to RGBA8 bytes`);
  }
  const expectedLength = width * height * 4;
  if (!Number.isSafeInteger(expectedLength) || data.byteLength !== expectedLength) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} decoded an invalid RGBA8 payload`);
  }
  return ownedLevel(data, width, height);
};

/** Validates and owns the deterministic RGBA result returned by the Basis transcoder. */
export const decodedGltfBasisuRgba = (
  parsed: unknown,
  label: string,
  bytes?: ArrayBuffer,
): DecodedGltfBasisuRgbaTexture => {
  const dimensions = bytes === undefined ? undefined : ktx2LogicalDimensions(bytes);
  const levels = parsedBasisLevels(parsed, label).map((level, index) =>
    rgbaLevel(logicalBasisLevel(level, dimensions, index, label), label, index));
  validMipSizes(levels, label);
  const base = levels[0]!;
  return {
    data: base.data,
    height: base.height,
    kind: "rgba-texture",
    levels,
    width: base.width,
  };
};

const isBasisTextureLevel = (value: unknown): value is BasisTextureLevel =>
  typeof value === "object" && value !== null;

const basisTextureLevels = (value: unknown): readonly BasisTextureLevel[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const firstImage = value[0];
  if (!Array.isArray(firstImage)) return undefined;
  return firstImage.every(isBasisTextureLevel) ? firstImage : undefined;
};
