import type {
  DecodedTextureAlpha,
  TextureAlphaLevel,
} from "./alpha-mipmap";

const nextDimension = (value: number): number => Math.max(1, Math.floor(value / 2));

/**
 * Builds the bounded alpha-only mip chain used by CPU picking. This remains in
 * the lazy browser-decode graph; the synchronous renderer only samples it.
 */
export const createTextureAlphaMipChain = (
  base: TextureAlphaLevel,
): DecodedTextureAlpha => {
  if (base.width < 1 || base.height < 1 || base.values.length !== base.width * base.height) {
    throw new RangeError("Royal texture alpha base level has invalid dimensions");
  }
  const levels: TextureAlphaLevel[] = [base];
  let source = base;
  while (source.width > 1 || source.height > 1) {
    const width = nextDimension(source.width);
    const height = nextDimension(source.height);
    const values = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const sourceY0 = Math.floor(y * source.height / height);
      const sourceY1 = Math.max(sourceY0 + 1, Math.floor((y + 1) * source.height / height));
      for (let x = 0; x < width; x += 1) {
        const sourceX0 = Math.floor(x * source.width / width);
        const sourceX1 = Math.max(sourceX0 + 1, Math.floor((x + 1) * source.width / width));
        let sum = 0;
        let count = 0;
        for (let sourceY = sourceY0; sourceY < sourceY1; sourceY += 1) {
          const row = sourceY * source.width;
          for (let sourceX = sourceX0; sourceX < sourceX1; sourceX += 1) {
            sum += source.values[row + sourceX]!;
            count += 1;
          }
        }
        values[y * width + x] = Math.round(sum / count);
      }
    }
    source = { height, values, width };
    levels.push(source);
  }
  return { ...base, levels };
};
