import { describe, expect, expectTypeOf, it } from 'vitest';
import * as reactRoyal from '@royal/react';
import { jsx } from '@royal/react/jsx-runtime';
import {
  Canvas,
  createRoot,
  markRendererComponent,
  orbitPerspectiveCamera,
  useFrame,
  useFrameIndex,
  type CanvasRendererOptions,
  type CanvasProps,
  type FrameCallback,
  type FrameSnapshot,
  type RoyalRendererBackend,
  type RoyalRoot,
  type RoyalRootContextOptions,
  type RoyalRootOptions
} from '@royal/react';
import {
  boxGeometry,
  imageTexture,
  mesh,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  type RenderRoot,
  text,
  type TextNode,
  type TextOptions
} from '@royal/renderer-core';
import {
  layoutText,
  shapeText,
  textMesh,
  type ShapeTextResult,
  type TextLayout,
  type TextMesh
} from '@royal/renderer-core/text';
import {
  createSvgGatewayGeometry,
  svgPathToContours,
  type SvgGatewayGeometry as RendererCoreSvgGeometry
} from '@royal/renderer-core/svg';
import * as rendererCoreSvg from '@royal/renderer-core/svg';
import * as rendererCoreText from '@royal/renderer-core/text';
import type {
  TextLayout as RendererCoreTextLayout,
  TextMesh as RendererCoreTextMesh
} from '@royal/renderer-core/text';
import {
  collectRendererCapabilityRows,
  type RendererCapabilityProbeResult
} from '@royal/renderer-webgl/capabilities';
import * as rendererCore from '@royal/renderer-core';

describe('Royal public API smoke tests', () => {
  it('lets consumers build a render root through the React adapter and renderer-core primitives', () => {
    const camera = perspectiveCamera({
      position: [0, 0, 6],
      rotation: [0, 0, 0],
      fovY: Math.PI / 3,
      near: 0.1,
      far: 100
    });
    const root = scene({
      children: [
        pass({
          camera,
          children: [
            mesh({
              geometry: boxGeometry({ size: [1, 1, 1] }),
              material: standardMaterial({
                color: [0.2, 0.4, 0.8, 1]
              })
            })
          ]
        })
      ]
    });
    const albedo = imageTexture('/albedo.png');
    const jsxMesh = jsx('mesh', {
      texture: albedo,
      geometry: boxGeometry({ size: [1, 1, 1] })
    });
    const terseRoot = scene({
      children: [
        pass({
          camera,
          children: [
            mesh({
              geometry: boxGeometry({ size: [1, 1, 1] }),
              material: standardMaterial({ texture: albedo })
            })
          ]
        })
      ]
    });
    const textNode = text({
      color: [1, 1, 1, 1],
      text: 'api'
    });

    expect(typeof Canvas).toBe('function');
    expect(typeof markRendererComponent).toBe('function');
    expect(typeof orbitPerspectiveCamera).toBe('function');
    expect(typeof useFrame).toBe('function');
    expect(typeof useFrameIndex).toBe('function');
    expect(reactRoyal).not.toHaveProperty('boxGeometry');
    expect(reactRoyal).not.toHaveProperty('text');
    expect(root.children[0]?.children).toHaveLength(1);
    expect(terseRoot.children[0]?.children[0]).toMatchObject({
      material: { baseColor: albedo, kind: 'standard' }
    });
    expect(jsxMesh).toMatchObject({
      material: { baseColor: albedo, kind: 'standard' }
    });
    expect(textNode.layout.source).toBe('api');
    expectTypeOf<CanvasProps>().toMatchTypeOf<{ readonly children: unknown }>();
    expectTypeOf<CanvasProps>().toMatchTypeOf<{ readonly fallback?: unknown }>();
    expectTypeOf<CanvasProps>().toMatchTypeOf<{
      readonly ref?: ((canvas: HTMLCanvasElement | null) => void) | { current: HTMLCanvasElement | null } | null;
    }>();
    expectTypeOf<CanvasProps>().toMatchTypeOf<{ readonly renderer?: CanvasRendererOptions }>();
    expectTypeOf<CanvasProps>().not.toHaveProperty('rootOptions');
    expectTypeOf<CanvasRendererOptions>().toMatchTypeOf<{
      readonly backend?: RoyalRendererBackend;
      readonly context?: RoyalRootContextOptions;
    }>();
    expectTypeOf<CanvasRendererOptions>().not.toHaveProperty('fallback');
    expectTypeOf<RoyalRendererBackend>().toEqualTypeOf<'auto' | 'webgl2'>();
    expectTypeOf<RoyalRootOptions>().toMatchTypeOf<{
      readonly backend?: RoyalRendererBackend;
      readonly context?: { readonly antialias?: boolean };
    }>();
    expectTypeOf<RoyalRootOptions>().not.toHaveProperty('alpha');
    expectTypeOf<RoyalRootContextOptions>().toMatchTypeOf<{
      readonly alpha?: boolean;
      readonly antialias?: boolean;
      readonly preserveDrawingBuffer?: boolean;
    }>();
    expectTypeOf(createRoot).toEqualTypeOf<(
      canvas: HTMLCanvasElement,
      options?: RoyalRootOptions
    ) => RoyalRoot>();
    expectTypeOf(useFrame).toEqualTypeOf<(callback: FrameCallback, priority?: number) => void>();
    expectTypeOf(useFrameIndex).toEqualTypeOf<() => number>();
    expectTypeOf<FrameCallback>().toEqualTypeOf<(frame: FrameSnapshot) => void>();
    expectTypeOf<FrameSnapshot>().toEqualTypeOf<{
      readonly delta: number;
      readonly index: number;
      readonly timestamp: number;
    }>();
    expectTypeOf<RoyalRoot>().toMatchTypeOf<{
      readonly dispose: () => void;
    }>();
    expectTypeOf(root).toEqualTypeOf<RenderRoot>();
    expectTypeOf(textNode).toEqualTypeOf<TextNode>();
  });

  it('exposes renderer-core text shaping, layout, and mesh helpers from the renderer package', () => {
    const shaped = shapeText({ text: 'AV office' });
    const layout = layoutText({
      fontSize: 2,
      lineHeight: 3,
      text: 'AV\noffice'
    });
    const textNode = text({
      color: [0.9, 0.9, 0.9, 1],
      text: 'AV'
    });
    const meshFromLayout = textMesh(layout);
    const meshFromNode = textMesh(textNode);
    const kernedGlyph = shaped.run.glyphs[1];

    expect(kernedGlyph?.kerning?.adjustment).toBeLessThan(0);
    expect(kernedGlyph?.kerning?.pair).toEqual([
      shaped.run.glyphs[0]?.glyphId,
      kernedGlyph?.glyphId
    ]);
    expect(layout.lines).toHaveLength(2);
    expect(meshFromLayout.vertices.length).toBeGreaterThan(0);
    expect(textMesh(layout)).toEqual(meshFromLayout);
    expect(meshFromNode.indices.length).toBeGreaterThan(0);
    expect(rendererCore).not.toHaveProperty('vectorText');
    expect(rendererCore).not.toHaveProperty('vectorTextMesh');
    expect(rendererCore).not.toHaveProperty('vectorTextGlyphRects');
    expect(rendererCore).not.toHaveProperty('vectorTextSupportedCharacters');
    expect(rendererCore).not.toHaveProperty('textMeshFromLayout');
    expect(rendererCore).not.toHaveProperty('layoutText');
    expect(rendererCore).not.toHaveProperty('shapeText');
    expect(rendererCore).not.toHaveProperty('textMesh');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('vectorText');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('vectorTextMesh');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('textMeshFromLayout');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('layoutText');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('shapeText');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('textMesh');
    expectTypeOf(shaped).toEqualTypeOf<ShapeTextResult>();
    expectTypeOf(layout).toEqualTypeOf<TextLayout>();
    expectTypeOf(textNode).toEqualTypeOf<TextNode>();
    expectTypeOf(meshFromNode).toEqualTypeOf<TextMesh>();
    expectTypeOf<TextMesh['contours'][number]['role']>().toEqualTypeOf<'outline'>();
    expectTypeOf<TextOptions>().not.toHaveProperty('glyphs');
    expectTypeOf<TextNode>().not.toHaveProperty('glyphs');
    expectTypeOf<TextNode>().not.toHaveProperty('cellHeight');
  });

  it('exposes heavy renderer-core text and SVG lowering helpers through explicit subpaths', () => {
    const shaped = rendererCoreText.shapeText({ text: 'AV' });
    const layout = rendererCoreText.layoutText({
      fontSize: 1.5,
      text: 'subpath'
    });
    const meshFromLayout = rendererCoreText.textMesh(layout);
    const geometry = createSvgGatewayGeometry({
      height: 1,
      kind: 'rect',
      width: 2
    });
    const pathContours = svgPathToContours('M 0 0 L 2 0 L 2 1 Z');

    expect(rendererCoreText.shapeText).toBe(shapeText);
    expect(rendererCoreText.layoutText).toBe(layoutText);
    expect(rendererCoreText.textMesh).toBe(textMesh);
    expect(rendererCoreText).toHaveProperty('layoutEditableText');
    expect(rendererCoreSvg.createSvgGatewayGeometry).toBe(createSvgGatewayGeometry);
    expect(rendererCoreSvg.svgPathToContours).toBe(svgPathToContours);
    expect(rendererCore).not.toHaveProperty('createSvgGatewayGeometry');
    expect(rendererCore).not.toHaveProperty('createSvgGatewayPickRegion');
    expect(rendererCore).not.toHaveProperty('createSvgRasterTextureSource');
    expect(rendererCore).not.toHaveProperty('roundedRectToContour');
    expect(rendererCore).not.toHaveProperty('svgPathToContours');
    expect(rendererCore).not.toHaveProperty('triangulateSvgGatewayContours');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('createSvgGatewayGeometry');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('svgPathToContours');
    expect(shaped.run.glyphs).toHaveLength(2);
    expect(layout.source).toBe('subpath');
    expect(meshFromLayout.vertices.length).toBeGreaterThan(0);
    expect(geometry.kind).toBe('svg-gateway-geometry');
    expect(geometry.mesh.indices.length).toBeGreaterThan(0);
    expect(pathContours).toHaveLength(1);
    expectTypeOf(layout).toEqualTypeOf<RendererCoreTextLayout>();
    expectTypeOf(meshFromLayout).toEqualTypeOf<RendererCoreTextMesh>();
    expectTypeOf(geometry).toEqualTypeOf<RendererCoreSvgGeometry>();
  });

  it('exposes renderer capability diagnostics without package-internal imports', () => {
    const result = collectRendererCapabilityRows(
      {
        getExtension: () => undefined,
        getSupportedExtensions: () => []
      },
      { includeMissingDiagnostics: true }
    );

    expect(result.rows.some((row) => row.kind === 'context_version')).toBe(true);
    expect(result.rows.some((row) => row.kind === 'renderer_capability' && row.capability === 'webgl2')).toBe(true);
    expectTypeOf(result).toEqualTypeOf<RendererCapabilityProbeResult>();
  });

});
