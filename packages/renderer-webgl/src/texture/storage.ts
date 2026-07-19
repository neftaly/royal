/** Exact RGBA8/sRGB8-alpha allocation size, optionally including a mip chain. */
export const ordinaryTextureStorageBytes = (
  width: number,
  height: number,
  mipmapped: boolean,
): number => {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError("Royal ordinary texture dimensions must be positive safe integers");
  }
  let levelWidth = width;
  let levelHeight = height;
  let texels = 0;
  for (;;) {
    texels += levelWidth * levelHeight;
    if (!Number.isSafeInteger(texels)) {
      throw new RangeError("Royal ordinary texture allocation exceeds safe integer range");
    }
    if (!mipmapped || (levelWidth === 1 && levelHeight === 1)) break;
    levelWidth = Math.max(1, Math.floor(levelWidth / 2));
    levelHeight = Math.max(1, Math.floor(levelHeight / 2));
  }
  const bytes = texels * 4;
  if (!Number.isSafeInteger(bytes)) {
    throw new RangeError("Royal ordinary texture allocation exceeds safe integer range");
  }
  return bytes;
};
