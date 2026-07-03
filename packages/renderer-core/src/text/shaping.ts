import type { Glyph as OpenTypeGlyph } from 'opentype.js';
import {
  fontFaceDescriptor,
  fontForFace,
  missingTextFontMessage
} from './font-internal';
import type { TextFontFace, TextFontMetrics } from './font';
import {
  emptyBounds,
  replacementGlyphId,
  textBounds
} from './shared';
import type {
  ShapeTextOptions,
  ShapeTextResult,
  ShapedTextGlyph,
  TextBounds,
  TextGlyphId,
  TextRunMetrics,
  TextShapingDiagnostic
} from './types';

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
} from './types';

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
  throw new Error(missingTextFontMessage);
};
