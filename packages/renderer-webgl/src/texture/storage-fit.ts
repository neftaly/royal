import { ordinaryTextureStorageBytes } from "./storage";

export type TextureStorageSize = Readonly<{
  height: number;
  width: number;
}>;

/** Largest aspect-preserving integer size whose RGBA mip chain fits the ceiling. */
export const fitOrdinaryTextureStorage = (
  width: number,
  height: number,
  maxBytes: number,
): TextureStorageSize => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4) {
    throw new RangeError("Royal ordinary texture storage fit must allow at least four bytes");
  }
  if (ordinaryTextureStorageBytes(width, height, true) <= maxBytes) return { height, width };
  const longest = Math.max(width, height);
  let lower = 1;
  let upper = longest - 1;
  let result: TextureStorageSize = { height: 1, width: 1 };
  while (lower <= upper) {
    const candidate = Math.floor((lower + upper) / 2);
    const candidateWidth = Math.max(1, Math.floor(width / longest * candidate));
    const candidateHeight = Math.max(1, Math.floor(height / longest * candidate));
    if (ordinaryTextureStorageBytes(candidateWidth, candidateHeight, true) <= maxBytes) {
      result = { height: candidateHeight, width: candidateWidth };
      lower = candidate + 1;
    } else {
      upper = candidate - 1;
    }
  }
  return result;
};
