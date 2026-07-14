import { parse } from "@loaders.gl/core";
import { BasisLoader } from "@loaders.gl/textures";

type BasisTextureLevel = {
  readonly compressed?: boolean;
  readonly data?: ArrayBufferView;
  readonly height?: number;
  readonly shape?: string;
  readonly textureFormat?: string;
  readonly width?: number;
};

export type DecodedGltfBasisuTexture = {
  readonly data: Uint8Array;
  readonly height: number;
  readonly kind: "rgba-texture";
  readonly levels?: readonly DecodedGltfBasisuLevel[];
  readonly width: number;
};

export type DecodedGltfBasisuLevel = {
  readonly data: Uint8Array;
  readonly height: number;
  readonly width: number;
};

const isBasisTextureLevel = (value: unknown): value is BasisTextureLevel =>
  typeof value === "object" && value !== null;

const basisTextureLevels = (value: unknown): readonly BasisTextureLevel[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const firstImage = value[0];
  if (!Array.isArray(firstImage)) return undefined;
  return firstImage.every(isBasisTextureLevel) ? firstImage : undefined;
};

const rgbaLevel = (
  level: BasisTextureLevel,
  label: string,
  levelIndex: number,
): DecodedGltfBasisuLevel => {
  if (level.compressed === true || level.textureFormat !== "rgba8unorm") {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} did not transcode to uncompressed RGBA8`);
  }
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
  const data = level.data;
  if (!(data instanceof Uint8Array)) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} did not decode to RGBA8 bytes`);
  }

  const expectedLength = width * height * 4;
  if (!Number.isSafeInteger(expectedLength) || data.byteLength !== expectedLength) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} decoded an invalid RGBA8 payload`);
  }

  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return { data: copy, height, width };
};

export const decodeGltfBasisuRgba = async (
  bytes: ArrayBuffer,
  label: string,
): Promise<DecodedGltfBasisuTexture> => {
  const parsed = await parse(bytes, BasisLoader, {
    basis: {
      containerFormat: "auto",
      format: "rgba32",
    },
    worker: false,
  });
  return decodedGltfBasisuRgba(parsed, label);
};

/** Validates and owns the deterministic RGBA result returned by the Basis transcoder. */
export const decodedGltfBasisuRgba = (
  parsed: unknown,
  label: string,
): DecodedGltfBasisuTexture => {
  const parsedLevels = basisTextureLevels(parsed);
  if (parsedLevels === undefined || parsedLevels.length === 0) {
    throw new Error(`glTF KHR_texture_basisu ${label} did not contain a texture level`);
  }
  const levels = parsedLevels.map((level, index) => rgbaLevel(level, label, index));
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1]!;
    const level = levels[index]!;
    if (
      level.width !== Math.max(1, Math.floor(previous.width / 2))
      || level.height !== Math.max(1, Math.floor(previous.height / 2))
    ) throw new Error(`glTF KHR_texture_basisu ${label} has an invalid mip ${index} size`);
  }
  const level = levels[0]!;

  return {
    data: level.data,
    height: level.height,
    kind: "rgba-texture",
    levels,
    width: level.width,
  };
};
