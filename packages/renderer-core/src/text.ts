import { RenderNodeKind } from './kind';
import type { Rgba, Vec3 } from './primitives';

export type VectorTextCell = {
  readonly center: readonly [number, number];
  readonly column: number;
  readonly span: number;
};

export type VectorTextGlyph = {
  readonly cell?: VectorTextCell;
  readonly center: Vec3;
  readonly char: string;
  readonly span: number;
};

export type VectorTextRect = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type TextBounds = {
  readonly xMax: number;
  readonly xMin: number;
  readonly yMax: number;
  readonly yMin: number;
};

export type TextGlyphId = string;

export type TextGlyphOffset = readonly [x: number, y: number];

export type TextDiagnosticCode = 'unsupported-glyph';

export type TextShapingDiagnostic = {
  readonly cluster: number;
  readonly code: TextDiagnosticCode;
  readonly input: string;
  readonly message: string;
  readonly replacementGlyphId: TextGlyphId;
};

export type TextKerningMetadata = {
  readonly adjustment: number;
  readonly pair: readonly [TextGlyphId, TextGlyphId];
};

export type TextLigatureMetadata = {
  readonly components: readonly string[];
  readonly source: string;
};

export type ShapedTextGlyph = {
  readonly advance: number;
  readonly bounds: TextBounds;
  readonly cluster: number;
  readonly glyphId: TextGlyphId;
  readonly kerning?: TextKerningMetadata;
  readonly ligature?: TextLigatureMetadata;
  readonly offset: TextGlyphOffset;
  readonly text: string;
};

export type TextRunMetrics = {
  readonly advance: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly lineHeight: number;
};

export type ShapedTextRun = {
  readonly direction: 'ltr';
  readonly glyphs: readonly ShapedTextGlyph[];
  readonly metrics: TextRunMetrics;
};

export type TextFontMetrics = {
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly lineHeight: number;
  readonly size: number;
};

export type TextFontDescriptor = {
  readonly family: string;
  readonly metrics: TextFontMetrics;
  readonly unitsPerEm: number;
};

export type TextGlyphLayout = {
  readonly bounds: TextBounds;
  readonly glyph: ShapedTextGlyph;
  readonly origin: Vec3;
};

export type TextLineLayout = {
  readonly bounds: TextBounds;
  readonly glyphs: readonly TextGlyphLayout[];
  readonly index: number;
  readonly metrics: TextRunMetrics;
  readonly origin: Vec3;
  readonly runs: readonly ShapedTextRun[];
  readonly text: string;
};

export type TextBlockMetrics = {
  readonly height: number;
  readonly lineHeight: number;
  readonly width: number;
};

export type TextLayout = {
  readonly bounds: TextBounds;
  readonly diagnostics: readonly TextShapingDiagnostic[];
  readonly font: TextFontDescriptor;
  readonly lines: readonly TextLineLayout[];
  readonly metrics: TextBlockMetrics;
  readonly source: string;
};

export type TextMeshContourRole = 'bar' | 'dot' | 'fill' | 'stem';

export type TextMeshContour = {
  readonly bounds: TextBounds;
  readonly glyphIndex: number;
  readonly role: TextMeshContourRole;
};

export type TextMeshVertex = {
  readonly glyphCoord: readonly [u: number, v: number];
  readonly glyphIndex: number;
  readonly position: Vec3;
};

export type TextMesh = {
  readonly bounds: TextBounds;
  readonly contours: readonly TextMeshContour[];
  readonly indices: readonly number[];
  readonly vertices: readonly TextMeshVertex[];
};

export interface ShapeTextOptions {
  readonly clusterOffset?: number;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly text: string;
}

export type ShapeTextResult = {
  readonly diagnostics: readonly TextShapingDiagnostic[];
  readonly font: TextFontDescriptor;
  readonly run: ShapedTextRun;
};

export interface LayoutTextOptions {
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly origin?: Vec3;
  readonly text: string;
}

export interface VectorTextNode {
  readonly kind: RenderNodeKind.VectorText;
  readonly cellHeight: number;
  readonly color: Rgba;
  readonly diagnostics: readonly TextShapingDiagnostic[];
  readonly glyphs: readonly VectorTextGlyph[];
  readonly layout: TextLayout;
}

export interface VectorTextGlyphOptions {
  readonly cellHeight?: number;
  readonly color: Rgba;
  readonly glyphs: readonly VectorTextGlyph[];
  readonly text?: never;
}

export interface VectorTextStringOptions {
  readonly cellHeight?: number;
  readonly color: Rgba;
  readonly fontSize?: number;
  readonly glyphs?: never;
  readonly lineHeight?: number;
  readonly origin?: Vec3;
  readonly text: string;
}

export type VectorTextOptions = VectorTextGlyphOptions | VectorTextStringOptions;
export type TextNode = VectorTextNode;
export type TextOptions = VectorTextOptions;
export type TextGlyphOptions = VectorTextGlyphOptions;
export type TextStringOptions = VectorTextStringOptions;

const glyphRows = 7;
const glyphColumns = 5;
const glyphFill = 0.78;

const glyphPatterns = {
  ' ': [
    '00000',
    '00000',
    '00000',
    '00000',
    '00000',
    '00000',
    '00000'
  ],
  a: [
    '01110',
    '10001',
    '10001',
    '11111',
    '10001',
    '10001',
    '10001'
  ],
  b: [
    '11110',
    '10001',
    '10001',
    '11110',
    '10001',
    '10001',
    '11110'
  ],
  c: [
    '01111',
    '10000',
    '10000',
    '10000',
    '10000',
    '10000',
    '01111'
  ],
  d: [
    '11110',
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '11110'
  ],
  e: [
    '11111',
    '10000',
    '10000',
    '11110',
    '10000',
    '10000',
    '11111'
  ],
  f: [
    '11111',
    '10000',
    '10000',
    '11110',
    '10000',
    '10000',
    '10000'
  ],
  g: [
    '01111',
    '10000',
    '10000',
    '10111',
    '10001',
    '10001',
    '01111'
  ],
  h: [
    '10001',
    '10001',
    '10001',
    '11111',
    '10001',
    '10001',
    '10001'
  ],
  i: [
    '11111',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '11111'
  ],
  j: [
    '00111',
    '00010',
    '00010',
    '00010',
    '10010',
    '10010',
    '01100'
  ],
  k: [
    '10001',
    '10010',
    '10100',
    '11000',
    '10100',
    '10010',
    '10001'
  ],
  l: [
    '10000',
    '10000',
    '10000',
    '10000',
    '10000',
    '10000',
    '11111'
  ],
  m: [
    '10001',
    '11011',
    '10101',
    '10101',
    '10001',
    '10001',
    '10001'
  ],
  n: [
    '10001',
    '11001',
    '10101',
    '10011',
    '10001',
    '10001',
    '10001'
  ],
  o: [
    '01110',
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '01110'
  ],
  p: [
    '11110',
    '10001',
    '10001',
    '11110',
    '10000',
    '10000',
    '10000'
  ],
  q: [
    '01110',
    '10001',
    '10001',
    '10001',
    '10101',
    '10010',
    '01101'
  ],
  r: [
    '11110',
    '10001',
    '10001',
    '11110',
    '10100',
    '10010',
    '10001'
  ],
  s: [
    '01111',
    '10000',
    '10000',
    '01110',
    '00001',
    '00001',
    '11110'
  ],
  t: [
    '11111',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100',
    '00100'
  ],
  u: [
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '01110'
  ],
  v: [
    '10001',
    '10001',
    '10001',
    '10001',
    '10001',
    '01010',
    '00100'
  ],
  w: [
    '10001',
    '10001',
    '10001',
    '10101',
    '10101',
    '10101',
    '01010'
  ],
  x: [
    '10001',
    '10001',
    '01010',
    '00100',
    '01010',
    '10001',
    '10001'
  ],
  y: [
    '10001',
    '10001',
    '01010',
    '00100',
    '00100',
    '00100',
    '00100'
  ],
  z: [
    '11111',
    '00001',
    '00010',
    '00100',
    '01000',
    '10000',
    '11111'
  ]
} as const satisfies Record<string, readonly string[]>;

export const vectorTextSupportedCharacters = Object.freeze(Object.keys(glyphPatterns));
const vectorTextSupportedCharacterSet = new Set<string>(vectorTextSupportedCharacters);

const patternFor = (char: string): readonly string[] => {
  const pattern = glyphPatterns[char as keyof typeof glyphPatterns];
  if (pattern !== undefined) return pattern;
  throw new Error(`Unsupported vector glyph: ${JSON.stringify(char)}`);
};

const builtinTextFamily = 'royal-ascii-prototype';
const replacementGlyphId = 'glyph:.notdef';
const minimumTextUnit = 0.0001;

const narrowGlyphs = new Set(['i', 'j', 'l', 'I', '!', '|', '.', ',', ':', ';', "'", '`']);
const wideGlyphs = new Set(['m', 'w', 'M', 'W', '@', '#', '%', '&']);
const descenderGlyphs = new Set(['g', 'j', 'p', 'q', 'y']);
const roundGlyphs = new Set(['0', '6', '8', '9', 'O', 'Q', 'o', 'b', 'd', 'g', 'p', 'q']);
const crossbarGlyphs = new Set(['A', 'E', 'F', 'H', 'a', 'e', 'f', 't']);
const whitespaceGlyphs = new Set([' ', '\t']);

const kerningPairs: Readonly<Record<string, number>> = {
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

const ligatures = [
  { components: ['f', 'f', 'i'], saving: 0.26, source: 'ffi' },
  { components: ['f', 'f', 'l'], saving: 0.25, source: 'ffl' },
  { components: ['f', 'f'], saving: 0.14, source: 'ff' },
  { components: ['f', 'i'], saving: 0.16, source: 'fi' },
  { components: ['f', 'l'], saving: 0.15, source: 'fl' }
] as const;

const positiveTextUnit = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : minimumTextUnit;

const fontMetrics = (fontSize: number, requestedLineHeight: number | undefined): TextFontMetrics => {
  const size = positiveTextUnit(fontSize);
  const naturalLineHeight = size * 1.2;
  const lineHeight = positiveTextUnit(requestedLineHeight ?? naturalLineHeight);
  const ascender = size * 0.82;
  const descender = -size * 0.22;
  const lineGap = Math.max(0, lineHeight - (ascender - descender));

  return {
    ascender,
    descender,
    lineGap,
    lineHeight,
    size
  };
};

const fontDescriptor = (fontSize: number, lineHeight: number | undefined): TextFontDescriptor => ({
  family: builtinTextFamily,
  metrics: fontMetrics(fontSize, lineHeight),
  unitsPerEm: 1
});

const textBounds = (xMin: number, yMin: number, xMax: number, yMax: number): TextBounds => ({
  xMax,
  xMin,
  yMax,
  yMin
});

const emptyBounds: TextBounds = textBounds(0, 0, 0, 0);
const defaultOrigin: Vec3 = [0, 0, 0];

const unionBounds = (
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

const translateBounds = (bounds: TextBounds, x: number, y: number): TextBounds =>
  textBounds(bounds.xMin + x, bounds.yMin + y, bounds.xMax + x, bounds.yMax + y);

const isPrintableAscii = (char: string): boolean => {
  if (char === '\t') return true;
  if (char.length !== 1) return false;
  const code = char.codePointAt(0) ?? -1;
  return code >= 32 && code <= 126;
};

const asciiAdvance = (char: string): number => {
  if (char === ' ') return 0.34;
  if (char === '\t') return 1.36;
  if (narrowGlyphs.has(char)) return 0.28;
  if (wideGlyphs.has(char)) return 0.86;
  if (/[0-9]/u.test(char)) return 0.58;
  if (/[A-Z]/u.test(char)) return 0.66;
  if (/[a-z]/u.test(char)) return 0.54;
  if (/[-_+=/\\]/u.test(char)) return 0.5;
  if (/[\[\](){}]/u.test(char)) return 0.38;
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
  const font = fontDescriptor(options.fontSize ?? 1, options.lineHeight);
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
    lines,
    metrics: {
      height: bounds.yMax - bounds.yMin,
      lineHeight: font.metrics.lineHeight,
      width: lines.reduce((width, line) => Math.max(width, line.metrics.advance), 0)
    },
    source: options.text
  };
};

const legacyLayout = (glyphs: readonly VectorTextGlyph[], cellHeight: number): TextLayout => {
  const height = positiveTextUnit(cellHeight);
  const metrics: TextFontMetrics = {
    ascender: height / 2,
    descender: -height / 2,
    lineGap: 0,
    lineHeight: height,
    size: height
  };
  const placements: TextGlyphLayout[] = glyphs.map((glyph, cluster) => {
    const span = positiveTextUnit(glyph.span);
    const shaped: ShapedTextGlyph = {
      advance: span,
      bounds: textBounds(-span / 2, -height / 2, span / 2, height / 2),
      cluster,
      glyphId: `vector:${glyph.char}`,
      offset: [0, 0],
      text: glyph.char
    };
    return {
      bounds: translateBounds(shaped.bounds, glyph.center[0], glyph.center[1]),
      glyph: shaped,
      origin: glyph.center
    };
  });
  const fallback = textBounds(0, -height / 2, 0, height / 2);
  const bounds = unionBounds(placements.map((glyph) => glyph.bounds), fallback);
  const runMetrics: TextRunMetrics = {
    advance: bounds.xMax - bounds.xMin,
    ascender: metrics.ascender,
    descender: metrics.descender,
    lineGap: metrics.lineGap,
    lineHeight: metrics.lineHeight
  };

  return {
    bounds,
    diagnostics: [],
    font: {
      family: 'royal-vector-compat',
      metrics,
      unitsPerEm: 1
    },
    lines: [{
      bounds,
      glyphs: placements,
      index: 0,
      metrics: runMetrics,
      origin: [0, 0, 0],
      runs: [{
        direction: 'ltr',
        glyphs: placements.map((placement) => placement.glyph),
        metrics: runMetrics
      }],
      text: glyphs.map((glyph) => glyph.char).join('')
    }],
    metrics: {
      height: bounds.yMax - bounds.yMin,
      lineHeight: metrics.lineHeight,
      width: bounds.xMax - bounds.xMin
    },
    source: glyphs.map((glyph) => glyph.char).join('')
  };
};

const glyphsFromLayout = (layout: TextLayout): readonly VectorTextGlyph[] => {
  const glyphs: VectorTextGlyph[] = [];

  for (const line of layout.lines) {
    for (const placement of line.glyphs) {
      const legacyChar = legacyVectorGlyphChar(placement.glyph.text);
      glyphs.push({
        center: [
          (placement.bounds.xMin + placement.bounds.xMax) / 2,
          (placement.bounds.yMin + placement.bounds.yMax) / 2,
          placement.origin[2]
        ],
        char: legacyChar,
        span: placement.glyph.advance
      });
    }
  }

  return glyphs;
};

const legacyVectorGlyphChar = (text: string): string => {
  const firstChar = [...text][0] ?? ' ';
  if (vectorTextSupportedCharacterSet.has(firstChar)) return firstChar;

  const lowerChar = firstChar.toLowerCase();
  if (vectorTextSupportedCharacterSet.has(lowerChar)) return lowerChar;

  return ' ';
};

export const vectorText = (options: VectorTextOptions): VectorTextNode => {
  const cellHeight = options.cellHeight ?? ('fontSize' in options ? options.fontSize : undefined) ?? 1;

  if (options.text !== undefined) {
    const layout = layoutText({
      fontSize: options.fontSize ?? cellHeight,
      ...(options.lineHeight === undefined ? {} : { lineHeight: options.lineHeight }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      text: options.text
    });

    return {
      kind: RenderNodeKind.VectorText,
      cellHeight,
      color: options.color,
      diagnostics: layout.diagnostics,
      glyphs: glyphsFromLayout(layout),
      layout
    };
  }

  for (const glyph of options.glyphs) patternFor(glyph.char);
  const layout = legacyLayout(options.glyphs, cellHeight);

  return {
    kind: RenderNodeKind.VectorText,
    cellHeight,
    color: options.color,
    diagnostics: layout.diagnostics,
    glyphs: options.glyphs,
    layout
  };
};

export const text = vectorText;

const contourBounds = (
  bounds: TextBounds,
  xMinRatio: number,
  yMinRatio: number,
  xMaxRatio: number,
  yMaxRatio: number
): TextBounds => {
  const width = bounds.xMax - bounds.xMin;
  const height = bounds.yMax - bounds.yMin;
  return textBounds(
    bounds.xMin + width * xMinRatio,
    bounds.yMin + height * yMinRatio,
    bounds.xMin + width * xMaxRatio,
    bounds.yMin + height * yMaxRatio
  );
};

const addContour = (
  contours: TextMeshContour[],
  glyphIndex: number,
  bounds: TextBounds,
  role: TextMeshContourRole
): void => {
  if (bounds.xMax <= bounds.xMin || bounds.yMax <= bounds.yMin) return;
  contours.push({ bounds, glyphIndex, role });
};

const contoursForGlyph = (placement: TextGlyphLayout, glyphIndex: number): readonly TextMeshContour[] => {
  const text = placement.glyph.ligature?.source ?? placement.glyph.text;
  const bounds = placement.bounds;
  const contours: TextMeshContour[] = [];

  if ([...text].every((char) => whitespaceGlyphs.has(char))) return contours;

  if (text === '.' || text === ',') {
    addContour(contours, glyphIndex, contourBounds(bounds, 0.28, 0, 0.72, 0.55), 'dot');
    return contours;
  }

  if (text === ':' || text === ';') {
    addContour(contours, glyphIndex, contourBounds(bounds, 0.28, 0, 0.72, 0.28), 'dot');
    addContour(contours, glyphIndex, contourBounds(bounds, 0.28, 0.65, 0.72, 0.93), 'dot');
    return contours;
  }

  if (text === '-' || text === '_' || text === '=') {
    addContour(contours, glyphIndex, contourBounds(bounds, 0, 0.42, 1, 0.58), 'bar');
    if (text === '=') addContour(contours, glyphIndex, contourBounds(bounds, 0, 0.68, 1, 0.84), 'bar');
    return contours;
  }

  if (text === 'i' || text === 'j') {
    addContour(contours, glyphIndex, contourBounds(bounds, 0.35, 0, 0.65, 0.68), 'stem');
    addContour(contours, glyphIndex, contourBounds(bounds, 0.3, 0.82, 0.7, 1), 'dot');
    return contours;
  }

  const first = text[0] ?? '';
  if (roundGlyphs.has(first)) {
    addContour(contours, glyphIndex, contourBounds(bounds, 0, 0.78, 1, 1), 'bar');
    addContour(contours, glyphIndex, contourBounds(bounds, 0, 0, 1, 0.22), 'bar');
    addContour(contours, glyphIndex, contourBounds(bounds, 0, 0.12, 0.22, 0.9), 'stem');
    addContour(contours, glyphIndex, contourBounds(bounds, 0.78, 0.12, 1, 0.9), 'stem');
    return contours;
  }

  if (crossbarGlyphs.has(first)) {
    addContour(contours, glyphIndex, contourBounds(bounds, 0, 0, 0.2, 1), 'stem');
    addContour(contours, glyphIndex, contourBounds(bounds, 0.8, 0, 1, 1), 'stem');
    addContour(contours, glyphIndex, contourBounds(bounds, 0.08, 0.42, 0.92, 0.6), 'bar');
    if (first === 'E' || first === 'F') addContour(contours, glyphIndex, contourBounds(bounds, 0.08, 0.82, 1, 1), 'bar');
    if (first === 'E') addContour(contours, glyphIndex, contourBounds(bounds, 0.08, 0, 1, 0.18), 'bar');
    return contours;
  }

  if (first === 'm' || first === 'w' || first === 'M' || first === 'W') {
    addContour(contours, glyphIndex, contourBounds(bounds, 0, 0, 0.18, 1), 'stem');
    addContour(contours, glyphIndex, contourBounds(bounds, 0.41, 0.08, 0.59, 0.92), 'stem');
    addContour(contours, glyphIndex, contourBounds(bounds, 0.82, 0, 1, 1), 'stem');
    return contours;
  }

  addContour(contours, glyphIndex, bounds, 'fill');
  return contours;
};

const glyphCoord = (glyphBounds: TextBounds, x: number, y: number): readonly [number, number] => {
  const width = Math.max(minimumTextUnit, glyphBounds.xMax - glyphBounds.xMin);
  const height = Math.max(minimumTextUnit, glyphBounds.yMax - glyphBounds.yMin);
  return [
    (x - glyphBounds.xMin) / width,
    (y - glyphBounds.yMin) / height
  ];
};

const appendContour = (
  vertices: TextMeshVertex[],
  indices: number[],
  contour: TextMeshContour,
  glyphBounds: TextBounds,
  z: number
): void => {
  const vertex = vertices.length;
  const bounds = contour.bounds;
  vertices.push(
    {
      glyphCoord: glyphCoord(glyphBounds, bounds.xMin, bounds.yMax),
      glyphIndex: contour.glyphIndex,
      position: [bounds.xMin, bounds.yMax, z]
    },
    {
      glyphCoord: glyphCoord(glyphBounds, bounds.xMax, bounds.yMax),
      glyphIndex: contour.glyphIndex,
      position: [bounds.xMax, bounds.yMax, z]
    },
    {
      glyphCoord: glyphCoord(glyphBounds, bounds.xMax, bounds.yMin),
      glyphIndex: contour.glyphIndex,
      position: [bounds.xMax, bounds.yMin, z]
    },
    {
      glyphCoord: glyphCoord(glyphBounds, bounds.xMin, bounds.yMin),
      glyphIndex: contour.glyphIndex,
      position: [bounds.xMin, bounds.yMin, z]
    }
  );
  indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
};

export const textMeshFromLayout = (layout: TextLayout): TextMesh => {
  const contours: TextMeshContour[] = [];
  const vertices: TextMeshVertex[] = [];
  const indices: number[] = [];
  let glyphIndex = 0;

  for (const line of layout.lines) {
    for (const placement of line.glyphs) {
      const glyphContours = contoursForGlyph(placement, glyphIndex);
      contours.push(...glyphContours);
      for (const contour of glyphContours) {
        appendContour(vertices, indices, contour, placement.bounds, placement.origin[2]);
      }
      glyphIndex += 1;
    }
  }

  return {
    bounds: layout.bounds,
    contours,
    indices,
    vertices
  };
};

export const vectorTextMesh = (node: VectorTextNode): TextMesh => {
  const nodeWithOptionalLayout = node as VectorTextNode & { readonly layout?: TextLayout };
  return textMeshFromLayout(nodeWithOptionalLayout.layout ?? legacyLayout(node.glyphs, node.cellHeight));
};

export const textMesh = (input: TextNode | TextLayout): TextMesh =>
  'kind' in input ? vectorTextMesh(input) : textMeshFromLayout(input);

export const vectorTextGlyphRects = (node: VectorTextNode): readonly VectorTextRect[] => {
  const rects: VectorTextRect[] = [];
  const cellHeight = Math.max(0.0001, node.cellHeight);

  for (const glyph of node.glyphs) {
    const pattern = patternFor(glyph.char);
    const span = Math.max(0.0001, glyph.span);
    const columnWidth = span / glyphColumns;
    const rowHeight = cellHeight / glyphRows;
    const rectWidth = columnWidth * glyphFill;
    const rectHeight = rowHeight * glyphFill;
    const left = glyph.center[0] - span / 2;
    const top = glyph.center[1] + cellHeight / 2;

    for (let row = 0; row < glyphRows; row += 1) {
      const cells = pattern[row];
      if (cells === undefined) continue;
      for (let column = 0; column < glyphColumns; column += 1) {
        if (cells[column] !== '1') continue;
        rects.push({
          height: rectHeight,
          width: rectWidth,
          x: left + column * columnWidth + (columnWidth - rectWidth) / 2,
          y: top - (row + 1) * rowHeight + (rowHeight - rectHeight) / 2,
          z: glyph.center[2]
        });
      }
    }
  }

  return rects;
};
