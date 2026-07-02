import type { Vec3 } from './primitives';
import type { TextBounds } from './text-types';

export const replacementGlyphId = 'glyph:.notdef';
export const minimumTextUnit = 0.0001;
export const defaultOutlineFlattenTolerance = 0.0025;

export const whitespaceGlyphs = new Set([' ', '\t']);

export const textBounds = (xMin: number, yMin: number, xMax: number, yMax: number): TextBounds => ({
  xMax,
  xMin,
  yMax,
  yMin
});

export const emptyBounds: TextBounds = textBounds(0, 0, 0, 0);
export const defaultOrigin: Vec3 = [0, 0, 0];

export const unionBounds = (
  bounds: Iterable<TextBounds>,
  fallback: TextBounds = emptyBounds
): TextBounds => {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;

  for (const bound of bounds) {
    xMin = Math.min(xMin, bound.xMin);
    yMin = Math.min(yMin, bound.yMin);
    xMax = Math.max(xMax, bound.xMax);
    yMax = Math.max(yMax, bound.yMax);
  }

  if (xMin === Infinity) return fallback;
  return textBounds(xMin, yMin, xMax, yMax);
};

export const translateBounds = (bounds: TextBounds, x: number, y: number): TextBounds =>
  textBounds(bounds.xMin + x, bounds.yMin + y, bounds.xMax + x, bounds.yMax + y);
