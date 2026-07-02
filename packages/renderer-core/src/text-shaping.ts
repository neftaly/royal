import type { Glyph as OpenTypeGlyph } from 'opentype.js';
import {
  fontDescriptor,
  fontFaceDescriptor,
  fontForFace
} from './text-font';
import type { TextFontFace, TextFontMetrics } from './text-font';
import {
  descenderGlyphs,
  emptyBounds,
  isPrintableAscii,
  kerningPairs,
  ligatures,
  narrowGlyphs,
  replacementGlyphId,
  textBounds,
  whitespaceGlyphs,
  wideGlyphs
} from './text-shared';
import type {
  ShapeTextOptions,
  ShapeTextResult,
  ShapedTextGlyph,
  TextBounds,
  TextGlyphId,
  TextRunMetrics,
  TextShapingDiagnostic
} from './text-types';

export type {
  ShapeTextOptions,
  ShapeTextResult,
  ShapedTextGlyph,
  ShapedTextRun,
  TextDiagnosticCode,
  TextGlyphId,
  TextGlyphOffset,
  TextKerningMetadata,
  TextLigatureMetadata,
  TextRunMetrics,
  TextShapingDiagnostic
} from './text-types';

const asciiAdvance = (char: string): number => {
  if (char === ' ') return 0.34;
  if (char === '\t') return 1.36;
  if (narrowGlyphs.has(char)) return 0.28;
  if (wideGlyphs.has(char)) return 0.86;
  if (/[0-9]/u.test(char)) return 0.58;
  if (/[A-Z]/u.test(char)) return 0.66;
  if (/[a-z]/u.test(char)) return 0.54;
  if (/[-_+=/\\]/u.test(char)) return 0.5;
  if ('[](){}'.includes(char)) return 0.38;
  return 0.46;
};

const asciiBounds = (char: string, advance: number, size: number): TextBounds => {
  if (whitespaceGlyphs.has(char)) return emptyBounds;

  const sideBearing = Math.min(size * 0.06, advance * 0.2);
  const xMin = sideBearing;
  const xMax = Math.max(xMin, advance - sideBearing);

  if (char === '.' || char === ',') {
    return textBounds(xMin, -size * 0.18, xMax, size * 0.02);
  }

  if (char === '-' || char === '=') {
    return textBounds(xMin, size * 0.28, xMax, size * 0.42);
  }

  const yMin = descenderGlyphs.has(char) ? -size * 0.22 : -size * 0.02;
  const yMax = /[A-Z0-9]/u.test(char) ? size * 0.78 : size * 0.66;
  return textBounds(xMin, yMin, xMax, yMax);
};

const shapeAsciiGlyph = (char: string, cluster: number, size: number): ShapedTextGlyph => {
  const advance = asciiAdvance(char) * size;
  return {
    advance,
    bounds: asciiBounds(char, advance, size),
    cluster,
    glyphId: `glyph:${char}`,
    offset: [0, 0],
    text: char
  };
};

const shapeReplacementGlyph = (
  char: string,
  cluster: number,
  size: number,
  diagnostics: TextShapingDiagnostic[]
): ShapedTextGlyph => {
  const advance = 0.62 * size;
  diagnostics.push({
    cluster,
    code: 'unsupported-glyph',
    input: char,
    message: `Unsupported text glyph ${JSON.stringify(char)}; using ${replacementGlyphId}`,
    replacementGlyphId
  });

  return {
    advance,
    bounds: textBounds(size * 0.06, -size * 0.02, advance - size * 0.06, size * 0.72),
    cluster,
    glyphId: replacementGlyphId,
    offset: [0, 0],
    text: char
  };
};

const glyphIdForFontGlyph = (face: TextFontFace, glyph: OpenTypeGlyph): TextGlyphId =>
  `font:${face.family}:${glyph.index}`;

const fontGlyphBounds = (glyph: OpenTypeGlyph, scale: number): TextBounds => {
  const box = glyph.getBoundingBox();
  return textBounds(box.x1 * scale, box.y1 * scale, box.x2 * scale, box.y2 * scale);
};

const shapeFontText = (options: ShapeTextOptions, face: TextFontFace): ShapeTextResult => {
  const font = fontForFace(face);
  const descriptor = fontFaceDescriptor(face, options.fontSize ?? 1, options.lineHeight);
  const scale = descriptor.metrics.size / face.unitsPerEm;
  const clusterOffset = options.clusterOffset ?? 0;
  const diagnostics: TextShapingDiagnostic[] = [];
  const glyphs: ShapedTextGlyph[] = [];
  let previousGlyph: OpenTypeGlyph | undefined;
  let previousGlyphId: TextGlyphId | undefined;
  let cluster = 0;

  while (cluster < options.text.length) {
    const codePoint = options.text.codePointAt(cluster);
    if (codePoint === undefined) break;

    const char = String.fromCodePoint(codePoint);
    const mapsToSpace = char === '\t';
    const fontChar = mapsToSpace ? ' ' : char;
    const supported = mapsToSpace || font.hasChar(fontChar);
    const glyph = supported ? font.charToGlyph(fontChar) : font.glyphs.get(0) ?? font.charToGlyph(' ');
    const glyphId = supported ? glyphIdForFontGlyph(face, glyph) : replacementGlyphId;
    const kerning = previousGlyph === undefined ? 0 : font.getKerningValue(previousGlyph, glyph) * scale;
    const advanceMultiplier = mapsToSpace ? 4 : 1;
    const advance = (glyph.advanceWidth ?? face.unitsPerEm) * scale * advanceMultiplier;

    if (!supported) {
      diagnostics.push({
        cluster: clusterOffset + cluster,
        code: 'unsupported-glyph',
        input: char,
        message: `Unsupported text glyph ${JSON.stringify(char)}; using ${replacementGlyphId}`,
        replacementGlyphId
      });
    }

    glyphs.push({
      advance,
      bounds: mapsToSpace ? emptyBounds : fontGlyphBounds(glyph, scale),
      cluster: clusterOffset + cluster,
      fontGlyphIndex: glyph.index,
      glyphId,
      ...(kerning === 0 || previousGlyphId === undefined ? {} : {
        kerning: {
          adjustment: kerning,
          pair: [previousGlyphId, glyphId] as const
        }
      }),
      offset: [kerning, 0],
      text: char
    });

    previousGlyph = glyph;
    previousGlyphId = glyphId;
    cluster += char.length;
  }

  return {
    diagnostics,
    font: descriptor,
    run: {
      direction: 'ltr',
      glyphs,
      metrics: metricsForRun(glyphs, descriptor.metrics)
    }
  };
};

const shapeLigatureGlyph = (
  source: string,
  components: readonly string[],
  saving: number,
  cluster: number,
  size: number
): ShapedTextGlyph => {
  const advance = Math.max(0.2, components.reduce((sum, char) => sum + asciiAdvance(char), 0) - saving) * size;
  return {
    advance,
    bounds: textBounds(size * 0.05, -size * 0.02, advance - size * 0.05, size * 0.68),
    cluster,
    glyphId: `liga:${source}`,
    ligature: {
      components,
      source
    },
    offset: [0, 0],
    text: source
  };
};

const matchingLigature = (text: string, cluster: number): (typeof ligatures)[number] | undefined => {
  for (const ligature of ligatures) {
    if (text.startsWith(ligature.source, cluster)) return ligature;
  }

  return undefined;
};

const applyKerning = (glyphs: readonly ShapedTextGlyph[], size: number): readonly ShapedTextGlyph[] => {
  const kerned: ShapedTextGlyph[] = [];

  for (const glyph of glyphs) {
    const previous = kerned.length === 0 ? undefined : kerned[kerned.length - 1];
    const adjustmentEm = previous === undefined ? 0 : kerningPairs[`${previous.text}/${glyph.text}`] ?? 0;
    if (previous === undefined || adjustmentEm === 0) {
      kerned.push(glyph);
      continue;
    }

    const adjustment = adjustmentEm * size;
    kerned.push({
      ...glyph,
      kerning: {
        adjustment,
        pair: [previous.glyphId, glyph.glyphId]
      },
      offset: [glyph.offset[0] + adjustment, glyph.offset[1]]
    });
  }

  return kerned;
};

const metricsForRun = (
  glyphs: readonly ShapedTextGlyph[],
  metrics: TextFontMetrics
): TextRunMetrics => ({
  advance: glyphs.reduce((sum, glyph) => sum + glyph.advance + glyph.offset[0], 0),
  ascender: metrics.ascender,
  descender: metrics.descender,
  lineGap: metrics.lineGap,
  lineHeight: metrics.lineHeight
});

export const shapeText = (options: ShapeTextOptions): ShapeTextResult => {
  if (options.font !== undefined) return shapeFontText(options, options.font);

  const font = fontDescriptor(options.fontSize ?? 1, options.lineHeight);
  const size = font.metrics.size;
  const clusterOffset = options.clusterOffset ?? 0;
  const diagnostics: TextShapingDiagnostic[] = [];
  const shapedGlyphs: ShapedTextGlyph[] = [];
  let cluster = 0;

  while (cluster < options.text.length) {
    const ligature = matchingLigature(options.text, cluster);
    if (ligature !== undefined) {
      shapedGlyphs.push(shapeLigatureGlyph(
        ligature.source,
        ligature.components,
        ligature.saving,
        clusterOffset + cluster,
        size
      ));
      cluster += ligature.source.length;
      continue;
    }

    const codePoint = options.text.codePointAt(cluster);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    shapedGlyphs.push(isPrintableAscii(char)
      ? shapeAsciiGlyph(char, clusterOffset + cluster, size)
      : shapeReplacementGlyph(char, clusterOffset + cluster, size, diagnostics));
    cluster += char.length;
  }

  const glyphs = applyKerning(shapedGlyphs, size);
  return {
    diagnostics,
    font,
    run: {
      direction: 'ltr',
      glyphs,
      metrics: metricsForRun(glyphs, font.metrics)
    }
  };
};
