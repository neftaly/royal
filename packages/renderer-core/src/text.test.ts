import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createTextFontFace,
  layoutText,
  shapeText,
  text,
  textMesh,
  textMeshFromLayout,
  vectorText,
  vectorTextGlyphRects,
  vectorTextMesh,
  type TextNode,
  type TextOptions
} from './text';

const require = createRequire(import.meta.url);
const atkinsonHyperlegibleRegular = (): ReturnType<typeof createTextFontFace> =>
  createTextFontFace({
    data: readFileSync(require.resolve(
      '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff'
    )),
    family: 'Atkinson Hyperlegible',
    source: '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff'
  });

describe('text shaping and mesh generation', () => {
  it('exposes text() as the stable authoring helper over the vector text node', () => {
    const node = text({
      color: [1, 1, 1, 1],
      fontSize: 2,
      text: 'Royal'
    });

    expect(node.kind).toBe('text');
    expect(node.layout.font.metrics.size).toBe(2);
    expect(node.layout.lines[0]?.glyphs.map((glyph) => glyph.glyph.text).join('')).toBe('Royal');
    expectTypeOf(text).toEqualTypeOf<(options: TextOptions) => TextNode>();
    expectTypeOf<TextOptions>().not.toHaveProperty('glyphs');
  });

  it('shapes proportional glyph advances and records kerning metadata', () => {
    const narrow = shapeText({ text: 'i' }).run.glyphs[0];
    const wide = shapeText({ text: 'm' }).run.glyphs[0];
    expect(narrow).toBeDefined();
    expect(wide).toBeDefined();
    expect(narrow!.advance).toBeLessThan(wide!.advance);

    const unkernedAdvance =
      shapeText({ text: 'A' }).run.metrics.advance +
      shapeText({ text: 'V' }).run.metrics.advance;
    const kerned = shapeText({ text: 'AV' });
    const kernedV = kerned.run.glyphs[1];

    expect(kernedV?.kerning).toMatchObject({
      adjustment: expect.any(Number),
      pair: ['glyph:A', 'glyph:V']
    });
    expect(kernedV?.kerning?.adjustment).toBeLessThan(0);
    expect(kerned.run.metrics.advance).toBeLessThan(unkernedAdvance);
  });

  it('emits ligature metadata with source cluster and combined advance', () => {
    const shaped = shapeText({ text: 'office' });
    const ligature = shaped.run.glyphs.find((glyph) => glyph.ligature?.source === 'ffi');

    expect(shaped.run.glyphs.map((glyph) => glyph.text)).toEqual(['o', 'ffi', 'c', 'e']);
    expect(ligature).toMatchObject({
      cluster: 1,
      glyphId: 'liga:ffi',
      ligature: {
        components: ['f', 'f', 'i'],
        source: 'ffi'
      }
    });
  });

  it('keeps unsupported glyphs in-band with diagnostics for shaped text', () => {
    const layout = layoutText({ text: 'a🙂b' });
    const line = layout.lines[0];

    expect(layout.diagnostics).toEqual([{
      cluster: 1,
      code: 'unsupported-glyph',
      input: '🙂',
      message: 'Unsupported text glyph "🙂"; using glyph:.notdef',
      replacementGlyphId: 'glyph:.notdef'
    }]);
    expect(line?.glyphs.map((glyph) => [glyph.glyph.text, glyph.glyph.glyphId, glyph.glyph.cluster])).toEqual([
      ['a', 'glyph:a', 0],
      ['🙂', 'glyph:.notdef', 1],
      ['b', 'glyph:b', 3]
    ]);
  });

  it('lays out lines with stable origins, run metrics, and block metrics', () => {
    const layout = layoutText({
      fontSize: 2,
      lineHeight: 3,
      origin: [4, 5, 6],
      text: 'i\nm'
    });

    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]?.origin).toEqual([4, 5, 6]);
    expect(layout.lines[1]?.origin).toEqual([4, 2, 6]);
    expect(layout.lines[0]?.metrics.lineHeight).toBe(3);
    expect(layout.lines[1]?.metrics.lineHeight).toBe(3);
    expect(layout.lines[0]?.metrics.advance).toBeLessThan(layout.lines[1]?.metrics.advance ?? 0);
    expect(layout.metrics.width).toBe(layout.lines[1]?.metrics.advance);
    expect(layout.metrics.lineHeight).toBe(3);
  });

  it('preserves legacy vectorText glyph validation and rectangle compatibility', () => {
    const legacy = vectorText({
      color: [1, 1, 1, 1],
      glyphs: [{
        center: [0, 0, 0],
        char: 'a',
        span: 1
      }]
    });

    expect(legacy.layout.font.family).toBe('royal-vector-compat');
    expect(vectorTextGlyphRects(legacy).length).toBeGreaterThan(0);
    expect(() => vectorText({
      color: [1, 1, 1, 1],
      glyphs: [{
        center: [0, 0, 0],
        char: '🙂',
        span: 2
      }]
    })).toThrow('Unsupported vector glyph');
  });

  it('keeps vectorText({ text }) layout rich while lowering compatibility glyphs for legacy rects', () => {
    const node = vectorText({
      color: [1, 1, 1, 1],
      text: 'AV office 🙂.'
    });

    expect(node.layout.lines[0]?.glyphs.map((glyph) => glyph.glyph.text)).toEqual([
      'A',
      'V',
      ' ',
      'o',
      'ffi',
      'c',
      'e',
      ' ',
      '🙂',
      '.'
    ]);
    expect(node.glyphs.map((glyph) => glyph.char)).toEqual(['a', 'v', ' ', 'o', 'f', 'c', 'e', ' ', ' ', ' ']);
    expect(node.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unsupported-glyph']);
    expect(() => vectorTextGlyphRects(node)).not.toThrow();
  });

  it('lays out empty text without vertices or diagnostics', () => {
    const layout = layoutText({ text: '' });
    const mesh = textMeshFromLayout(layout);

    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0]?.glyphs).toHaveLength(0);
    expect(layout.diagnostics).toHaveLength(0);
    expect(layout.metrics.width).toBe(0);
    expect(mesh.vertices).toHaveLength(0);
    expect(mesh.indices).toHaveLength(0);
  });

  it('creates contour mesh data with semantic contour roles for shaped text', () => {
    const node = vectorText({
      color: [1, 1, 1, 1],
      text: 'o'
    });
    const mesh = vectorTextMesh(node);

    expect(node.layout.font.family).toBe('royal-ascii-prototype');
    expect(mesh.contours.map((contour) => contour.role)).toEqual(['outline', 'outline', 'outline', 'outline']);
    expect(mesh.vertices).toHaveLength(16);
    expect(mesh.indices).toHaveLength(24);
  });

  it('shapes real font glyphs with parsed metrics and kerning', () => {
    const font = atkinsonHyperlegibleRegular();
    const shaped = shapeText({
      font,
      fontSize: 1,
      text: 'AV'
    });
    const glyphs = shaped.run.glyphs;

    expect(shaped.font.family).toBe('Atkinson Hyperlegible');
    expect(shaped.font.unitsPerEm).toBe(1000);
    expect(glyphs[0]?.fontGlyphIndex).toBeGreaterThan(0);
    expect(glyphs[1]?.kerning).toMatchObject({
      adjustment: expect.any(Number),
      pair: [glyphs[0]?.glyphId, glyphs[1]?.glyphId]
    });
    expect(glyphs[1]?.kerning?.adjustment).toBeLessThan(0);
    expect(shaped.run.metrics.advance).toBeLessThan(
      (glyphs[0]?.advance ?? 0) + (glyphs[1]?.advance ?? 0)
    );
  });

  it('triangulates real font outlines instead of synthetic contour rectangles', () => {
    const font = atkinsonHyperlegibleRegular();
    const layout = layoutText({
      font,
      fontSize: 1,
      text: 'o'
    });
    const realMesh = textMeshFromLayout(layout);
    const syntheticMesh = textMeshFromLayout(layoutText({
      fontSize: 1,
      text: 'o'
    }));

    expect(layout.fontFace).toBe(font);
    expect(realMesh.contours.map((contour) => contour.role)).toEqual(['outline']);
    expect(realMesh.vertices.length).toBeGreaterThan(syntheticMesh.vertices.length);
    expect(realMesh.indices.length).toBeGreaterThan(syntheticMesh.indices.length);
    expect(realMesh.bounds.yMax).toBeGreaterThan(0.45);
    expect(realMesh.bounds.yMin).toBeLessThan(0);
  });

  it('builds mesh data from either a text node or a layout through textMesh()', () => {
    const node = text({
      color: [1, 1, 1, 1],
      text: 'AV'
    });

    expect(textMesh(node)).toEqual(vectorTextMesh(node));
    expect(textMesh(node.layout)).toEqual(textMeshFromLayout(node.layout));
  });
});
