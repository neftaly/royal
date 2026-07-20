/**
 * Summarizes a downsampled canvas without counting an opaque clear as content.
 * Transparent canvases retain their established alpha-based behavior.
 */
export const summarizeCanvasPixels = (pixels, width, height) => {
  const pixelCount = width * height;
  const opaqueColors = new Map();
  let opaquePixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha !== 255) continue;
    opaquePixels += 1;
    const color = pixels[index] * 16_777_216
      + pixels[index + 1] * 65_536
      + pixels[index + 2] * 256
      + alpha;
    opaqueColors.set(color, (opaqueColors.get(color) ?? 0) + 1);
  }

  let backgroundColor;
  let backgroundPixels = 0;
  if (opaquePixels === pixelCount) {
    for (const [color, count] of opaqueColors) {
      if (count <= backgroundPixels) continue;
      backgroundColor = color;
      backgroundPixels = count;
    }
  }

  const buckets = new Set();
  let chromaSum = 0;
  let luminanceSum = 0;
  let saturationSum = 0;
  const luminances = [];
  let paintedPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha === 0) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const color = red * 16_777_216 + green * 65_536 + blue * 256 + alpha;
    if (color === backgroundColor) continue;
    paintedPixels += 1;
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    luminanceSum += luminance;
    luminances.push(luminance);
    const maximum = Math.max(red, green, blue);
    const chroma = maximum - Math.min(red, green, blue);
    chromaSum += chroma / 255;
    saturationSum += maximum === 0 ? 0 : chroma / maximum;
    buckets.add(`${red >> 5}:${green >> 5}:${blue >> 5}:${alpha >> 6}`);
  }

  luminances.sort((left, right) => left - right);
  const quantile = (fraction) => luminances.length === 0
    ? 0
    : luminances[Math.min(luminances.length - 1, Math.floor(fraction * luminances.length))];
  return {
    backgroundPixels,
    colorBuckets: buckets.size,
    meanPaintedChroma: paintedPixels === 0 ? 0 : chromaSum / paintedPixels,
    meanPaintedLuminance: paintedPixels === 0 ? 0 : luminanceSum / paintedPixels,
    meanPaintedSaturation: paintedPixels === 0 ? 0 : saturationSum / paintedPixels,
    paintedLuminanceP25: quantile(0.25),
    paintedLuminanceP50: quantile(0.5),
    paintedLuminanceP75: quantile(0.75),
    paintedPixels,
    paintedRatio: paintedPixels / pixelCount,
  };
};
