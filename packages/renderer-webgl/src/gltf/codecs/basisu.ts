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
  readonly width: number;
};

const isBasisTextureLevel = (value: unknown): value is BasisTextureLevel =>
  typeof value === "object" && value !== null;

const firstBasisTextureLevel = (value: unknown): BasisTextureLevel | undefined => {
  if (!Array.isArray(value)) return undefined;
  const firstImage = value[0];
  if (!Array.isArray(firstImage)) return undefined;
  const firstLevel = firstImage[0];

  return isBasisTextureLevel(firstLevel) ? firstLevel : undefined;
};

const rgbaBytes = (level: BasisTextureLevel, label: string): Uint8Array => {
  const data = level.data;
  if (!(data instanceof Uint8Array)) {
    throw new Error(`glTF KHR_texture_basisu ${label} did not decode to RGBA8 bytes`);
  }

  const expectedLength = (level.width ?? 0) * (level.height ?? 0) * 4;
  if (expectedLength <= 0 || data.byteLength !== expectedLength) {
    throw new Error(`glTF KHR_texture_basisu ${label} decoded an invalid RGBA8 payload`);
  }

  const copy = new Uint8Array(data.byteLength);
  copy.set(data);

  return copy;
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
  const level = firstBasisTextureLevel(parsed);
  if (level === undefined) {
    throw new Error(`glTF KHR_texture_basisu ${label} did not contain a texture level`);
  }
  if (level.compressed === true || level.textureFormat !== "rgba8unorm") {
    throw new Error(`glTF KHR_texture_basisu ${label} did not transcode to uncompressed RGBA8`);
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
    throw new Error(`glTF KHR_texture_basisu ${label} decoded invalid dimensions`);
  }

  return {
    data: rgbaBytes(level, label),
    height,
    kind: "rgba-texture",
    width,
  };
};
