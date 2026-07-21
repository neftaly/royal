export type TextureAlphaLevel = Readonly<{
  height: number;
  values: Uint8Array;
  width: number;
}>;

/** Retained alpha for exact MASK picking; `levels[0]` aliases the base fields. */
export type DecodedTextureAlpha = TextureAlphaLevel & Readonly<{
  levels?: readonly TextureAlphaLevel[];
}>;

const nextDimension = (value: number): number => Math.max(1, Math.floor(value / 2));

export const textureAlphaStorageBytes = (alpha: DecodedTextureAlpha): number => {
  const levels = alpha.levels;
  if (levels === undefined) return alpha.values.byteLength;
  let bytes = 0;
  for (const level of levels) bytes += level.values.byteLength;
  return bytes;
};

export const validateTextureAlphaMipChain = (alpha: DecodedTextureAlpha): void => {
  if (
    !Number.isSafeInteger(alpha.width)
    || alpha.width < 1
    || !Number.isSafeInteger(alpha.height)
    || alpha.height < 1
    || alpha.values.length !== alpha.width * alpha.height
  ) throw new RangeError("Royal texture alpha has invalid base storage");
  const levels = alpha.levels;
  if (levels === undefined) return;
  if (levels.length < 1) throw new RangeError("Royal texture alpha mip chain is empty");
  let width = alpha.width;
  let height = alpha.height;
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index]!;
    if (
      level.width !== width
      || level.height !== height
      || level.values.length !== width * height
      || (index === 0 && level.values !== alpha.values)
    ) throw new RangeError(`Royal texture alpha mip level ${index} has invalid storage`);
    width = nextDimension(width);
    height = nextDimension(height);
  }
};
