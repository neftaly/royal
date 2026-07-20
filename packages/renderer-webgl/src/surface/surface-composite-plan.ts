const mipLevelCount = (width: number, height: number): number =>
  Math.floor(Math.log2(Math.max(width, height))) + 1;

const mipPixelCount = (width: number, height: number, levels: number): number => {
  let pixels = 0;
  for (let level = 0; level < levels; level += 1) {
    pixels += width * height;
    width = Math.max(1, width >>> 1);
    height = Math.max(1, height >>> 1);
  }
  return pixels;
};

/** Full-resolution LOD scale retained even when unreachable suffix levels are omitted. */
export const transmissionSceneColorMaxLod = (width: number, height: number): number =>
  mipLevelCount(width, height) - 1;

/** Scene-color storage prefix reachable by the greatest visible authored roughness. */
export const transmissionSceneColorMipLevels = (
  width: number,
  height: number,
  maxRoughness: number,
): number => {
  const fullLevels = mipLevelCount(width, height);
  if (maxRoughness < 0.1 || fullLevels === 1) return 1;
  return Math.min(fullLevels, Math.ceil(maxRoughness * (fullLevels - 1)) + 1);
};

/** Exact color, depth, and optional scene-color storage admitted by a composite target. */
export const compositeTargetByteLength = (
  width: number,
  height: number,
  colorBytesPerPixel: 4 | 8,
  options: Readonly<{
    sceneColor?: boolean;
    sceneColorLevels?: number;
  }> = {},
): number => width * height * (colorBytesPerPixel + 4)
  + (options.sceneColor === false
    ? 0
    : mipPixelCount(
      width,
      height,
      options.sceneColorLevels ?? mipLevelCount(width, height),
    ) * colorBytesPerPixel);
