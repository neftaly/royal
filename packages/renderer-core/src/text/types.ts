import type { Rgba, Vec3 } from '../primitives';
import type { TextFontDescriptor, TextFontFace } from './font';

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
  readonly fontGlyphIndex?: number;
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
  readonly fontFace?: TextFontFace;
  readonly lines: readonly TextLineLayout[];
  readonly metrics: TextBlockMetrics;
  readonly source: string;
};

export type TextMeshContourRole = 'outline';

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
  readonly font?: TextFontFace;
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
  readonly font?: TextFontFace;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly origin?: Vec3;
  readonly text: string;
}

export interface TextNode {
  readonly kind: 'text';
  readonly color: Rgba;
  readonly diagnostics: readonly TextShapingDiagnostic[];
  readonly layout: TextLayout;
}

export interface TextOptions {
  readonly color: Rgba;
  readonly font?: TextFontFace;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly origin?: Vec3;
  readonly text: string;
}
