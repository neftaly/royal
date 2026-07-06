import type { Vec3 } from '../primitives';
import { textFontDescriptor } from './font-internal';
import type { TextFontMetrics } from './font';
import {
  defaultOrigin,
  textBounds,
  translateBounds,
  unionBounds
} from './shared';
import { shapeText } from './shaping';
import type {
  LayoutTextOptions,
  TextBounds,
  TextGlyphLayout,
  TextLayout,
  TextLineLayout,
  TextRunMetrics,
  TextShapingDiagnostic
} from './types';

export type {
  LayoutTextOptions,
  TextBlockMetrics,
  TextBounds,
  TextGlyphLayout,
  TextLayout,
  TextLineLayout
} from './types';

type TextLineSource = {
  readonly start: number;
  readonly text: string;
};

const splitTextLines = (text: string): readonly TextLineSource[] => {
  const lines: TextLineSource[] = [];
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\n') continue;
    lines.push({ start, text: text.slice(start, index) });
    start = index + 1;
  }

  lines.push({ start, text: text.slice(start) });
  return lines;
};

const lineFallbackBounds = (origin: Vec3, metrics: TextFontMetrics, advance: number): TextBounds =>
  textBounds(origin[0], origin[1] + metrics.descender, origin[0] + Math.max(0, advance), origin[1] + metrics.ascender);

export const layoutText = (options: LayoutTextOptions): TextLayout => {
  const origin = options.origin ?? defaultOrigin;
  const font = textFontDescriptor(options.font, options.fontSize ?? 1, options.lineHeight);
  const lines: TextLineLayout[] = [];
  const diagnostics: TextShapingDiagnostic[] = [];

  for (const [index, line] of splitTextLines(options.text).entries()) {
    const lineOrigin: Vec3 = [
      origin[0],
      origin[1] - index * font.metrics.lineHeight,
      origin[2]
    ];
    const shaped = shapeText({
      clusterOffset: line.start,
      font: options.font,
      fontSize: font.metrics.size,
      lineHeight: font.metrics.lineHeight,
      text: line.text
    });
    diagnostics.push(...shaped.diagnostics);

    const glyphs: TextGlyphLayout[] = [];
    let cursor = lineOrigin[0];
    for (const glyph of shaped.run.glyphs) {
      const glyphOrigin: Vec3 = [
        cursor + glyph.offset[0],
        lineOrigin[1] + glyph.offset[1],
        lineOrigin[2]
      ];
      glyphs.push({
        bounds: translateBounds(glyph.bounds, glyphOrigin[0], glyphOrigin[1]),
        glyph,
        origin: glyphOrigin
      });
      cursor += glyph.advance + glyph.offset[0];
    }

    const metrics: TextRunMetrics = {
      ...shaped.run.metrics,
      advance: cursor - lineOrigin[0]
    };
    lines.push({
      bounds: unionBounds(glyphs.map((glyph) => glyph.bounds), lineFallbackBounds(lineOrigin, font.metrics, metrics.advance)),
      glyphs,
      index,
      metrics,
      origin: lineOrigin,
      runs: [{
        ...shaped.run,
        metrics
      }],
      text: line.text
    });
  }

  const bounds = unionBounds(lines.map((line) => line.bounds), lineFallbackBounds(origin, font.metrics, 0));
  return {
    bounds,
    diagnostics,
    font,
    fontFace: options.font,
    lines,
    metrics: {
      height: bounds.yMax - bounds.yMin,
      lineHeight: font.metrics.lineHeight,
      width: lines.reduce((width, line) => Math.max(width, line.metrics.advance), 0)
    },
    source: options.text
  };
};
