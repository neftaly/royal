import type { Vec3 } from './primitives';
import type { TextBounds } from './text-types';

export const replacementGlyphId = 'glyph:.notdef';
export const minimumTextUnit = 0.0001;
export const defaultOutlineFlattenTolerance = 0.0025;

export const narrowGlyphs = new Set(['i', 'j', 'l', 'I', '!', '|', '.', ',', ':', ';', "'", '`']);
export const wideGlyphs = new Set(['m', 'w', 'M', 'W', '@', '#', '%', '&']);
export const descenderGlyphs = new Set(['g', 'j', 'p', 'q', 'y']);
export const roundGlyphs = new Set(['0', '6', '8', '9', 'O', 'Q', 'o', 'b', 'd', 'g', 'p', 'q']);
export const crossbarGlyphs = new Set(['A', 'E', 'F', 'H', 'a', 'e', 'f', 't']);
export const whitespaceGlyphs = new Set([' ', '\t']);

export const kerningPairs: Readonly<Record<string, number>> = {
  'A/V': -0.12,
  'A/W': -0.1,
  'A/Y': -0.13,
  'L/T': -0.08,
  'T/a': -0.1,
  'T/o': -0.11,
  'T/y': -0.09,
  'V/A': -0.11,
  'W/A': -0.08,
  'Y/A': -0.12,
  'Y/o': -0.1
};

export const ligatures = [
  { components: ['f', 'f', 'i'], saving: 0.26, source: 'ffi' },
  { components: ['f', 'f', 'l'], saving: 0.25, source: 'ffl' },
  { components: ['f', 'f'], saving: 0.14, source: 'ff' },
  { components: ['f', 'i'], saving: 0.16, source: 'fi' },
  { components: ['f', 'l'], saving: 0.15, source: 'fl' }
] as const;

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

export const isPrintableAscii = (char: string): boolean => {
  if (char === '\t') return true;
  if (char.length !== 1) return false;
  const code = char.codePointAt(0) ?? -1;
  return code >= 32 && code <= 126;
};

export const firstCodePoint = (text: string): string | undefined => {
  const codePoint = text.codePointAt(0);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
};

export const isWhitespaceText = (text: string): boolean => {
  let index = 0;

  while (index < text.length) {
    const char = firstCodePoint(text.slice(index));
    if (char === undefined || !whitespaceGlyphs.has(char)) return false;
    index += char.length;
  }

  return true;
};
