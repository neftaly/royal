export { createTextFontFace, createTextFontFaceAsync } from './font';
export type {
  CreateTextFontFaceOptions,
  TextFontData,
  TextFontDescriptor,
  TextFontFace,
  TextFontMetrics
} from './font';
export type {
  LayoutTextOptions,
  ShapeTextOptions,
  ShapeTextResult,
  ShapedTextGlyph,
  ShapedTextRun,
  TextBlockMetrics,
  TextBounds,
  TextDiagnosticCode,
  TextGlyphId,
  TextGlyphLayout,
  TextGlyphOffset,
  TextKerningMetadata,
  TextLayout,
  TextLigatureMetadata,
  TextLineLayout,
  TextMesh,
  TextMeshContour,
  TextMeshContourRole,
  TextMeshVertex,
  TextNode,
  TextOptions,
  TextRunMetrics,
  TextShapingDiagnostic
} from './types';
export { layoutText } from './layout';
export { textMesh } from './mesh';
export { text } from './node';
export { shapeText } from './shaping';
