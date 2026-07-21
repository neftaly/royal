import type { TextureColorSpace } from "@royal/renderer-core";

export type Ktx2Etc2Level = Readonly<{
  blocks: Uint8Array;
  height: number;
  width: number;
}>;

export type Ktx2Etc2Texture = Readonly<{
  colorSpace: TextureColorSpace;
  height: number;
  levels: readonly Ktx2Etc2Level[];
  width: number;
}>;

export const ETC2_RGBA8_WEBGL_FORMAT = 0x9278;
export const ETC2_SRGB8_ALPHA8_WEBGL_FORMAT = 0x9279;

/** One format authority shared by complete ordinary textures and VT page uploads. */
export const etc2RgbaWebGlFormat = (colorSpace: TextureColorSpace): number =>
  colorSpace === "srgb" ? ETC2_SRGB8_ALPHA8_WEBGL_FORMAT : ETC2_RGBA8_WEBGL_FORMAT;

export const completeKtx2MipLevelCount = (width: number, height: number): number =>
  Math.floor(Math.log2(Math.max(width, height))) + 1;

export const ktx2Etc2StorageBytes = (texture: Ktx2Etc2Texture): number => {
  let total = 0;
  for (const level of texture.levels) total += level.blocks.byteLength;
  return total;
};

/** Fits by dropping authored largest mip levels; compressed texels are never resampled. */
export const fitKtx2Etc2Storage = (
  texture: Ktx2Etc2Texture,
  maxBytes: number,
): Ktx2Etc2Texture => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("Royal KTX2 storage ceiling must be a positive safe integer");
  }
  let byteLength = ktx2Etc2StorageBytes(texture);
  let firstLevel = 0;
  while (byteLength > maxBytes && firstLevel < texture.levels.length - 1) {
    byteLength -= texture.levels[firstLevel]!.blocks.byteLength;
    firstLevel += 1;
  }
  if (byteLength > maxBytes) {
    throw new RangeError(
      `Royal ETC2 storage needs at least ${byteLength} bytes but its budget allows ${maxBytes}`,
    );
  }
  if (firstLevel === 0) return texture;
  const base = texture.levels[firstLevel]!;
  return {
    colorSpace: texture.colorSpace,
    height: base.height,
    levels: texture.levels.slice(firstLevel),
    width: base.width,
  };
};
