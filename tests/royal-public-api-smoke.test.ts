import { describe, expect, expectTypeOf, it } from 'vitest';
import * as reactRoyal from '@royal/react';
import {
  Canvas,
  createRoot,
  type CanvasProps,
  type RoyalRoot,
  type RoyalRootOptions
} from '@royal/react';
import {
  boxGeometry,
  mesh,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  type RenderRoot,
  text,
  type TextNode,
  layoutText,
  shapeText,
  textMesh,
  textMeshFromLayout,
  type ShapeTextResult,
  type TextLayout,
  type TextMesh,
  type TextOptions
} from '@royal/renderer-core';
import {
  collectRendererCapabilityRows,
  type RendererCapabilityProbeResult
} from '@royal/react/testing';
import * as rendererCore from '@royal/renderer-core';
import {
  assetIdForSrc,
  createRoyalAppBoundary,
  createRoyalLensSnapshot,
  royalCapabilityBoundaryContract,
  royalLensSchema,
  royalQueries,
  stableContainmentId,
  type RoyalReadableStore,
  type RoyalDocumentState,
  type RoyalInteractionState,
  type RoyalLayoutRuntimeState,
  type RoyalLensStores,
  type RoyalRenderRow
} from '@royal/tarstate-lens/v1';

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
              material: standardMaterial({ color: [0.2, 0.4, 0.8, 1] })
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
    expect(reactRoyal).not.toHaveProperty('boxGeometry');
    expect(reactRoyal).not.toHaveProperty('text');
    expect(root.children[0]?.children).toHaveLength(1);
    expect(textNode.glyphs.map((glyph) => glyph.char).join('')).toBe('api');
    expectTypeOf<CanvasProps>().toMatchTypeOf<{ readonly children: unknown }>();
    expectTypeOf<CanvasProps>().toMatchTypeOf<{ readonly rootOptions?: RoyalRootOptions }>();
    expectTypeOf<RoyalRootOptions>().toMatchTypeOf<{
      readonly context?: { readonly antialias?: boolean };
    }>();
    expectTypeOf<RoyalRootOptions>().not.toHaveProperty('alpha');
    expectTypeOf(createRoot).toEqualTypeOf<(
      canvas: HTMLCanvasElement,
      options?: RoyalRootOptions
    ) => RoyalRoot>();
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
    const meshFromLayout = textMeshFromLayout(layout);
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
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('vectorText');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('vectorTextMesh');
    expectTypeOf(shaped).toEqualTypeOf<ShapeTextResult>();
    expectTypeOf(layout).toEqualTypeOf<TextLayout>();
    expectTypeOf(textNode).toEqualTypeOf<TextNode>();
    expectTypeOf(meshFromNode).toEqualTypeOf<TextMesh>();
    expectTypeOf<TextMesh['contours'][number]['role']>().toEqualTypeOf<'outline'>();
    expectTypeOf<TextOptions>().not.toHaveProperty('glyphs');
  });

  it('exposes renderer testing helpers without package-internal imports', () => {
    const result = collectRendererCapabilityRows(
      {
        getExtension: () => undefined,
        getSupportedExtensions: () => []
      },
      { includeMissingDiagnostics: true }
    );

    expect(result.rows.some((row) => row.kind === 'context_version')).toBe(true);
    expect(result.rows.some((row) => row.kind === 'renderer_capability' && row.capability === 'webgl')).toBe(true);
    expectTypeOf(result).toEqualTypeOf<RendererCapabilityProbeResult>();
  });

  it('lets consumers query Royal store lenses without package-internal imports', async () => {
    const stores = createApiStores();
    const snapshot = createRoyalLensSnapshot(stores);
    const boundary = createRoyalAppBoundary(stores);
    const renderRows = await boundary.query(royalQueries.renderRows);

    expect(snapshot.probe.relationNames).toEqual(
      expect.arrayContaining([
        'scopes',
        'layoutBoxes',
        'pickTargets',
        'activationStates',
        'renderFlags',
        'layoutNodes',
        'assets'
      ])
    );
    expect(snapshot.probe.rowCount(royalLensSchema.layoutBoxes)).toBe(1);
    expect(snapshot.probe.rows(royalLensSchema.layoutBoxes)[0]?.boxId).toBe('card');
    expect(renderRows.diagnostics).toEqual([]);
    expect(renderRows.rows).toEqual([
      {
        scopeId: 'api',
        boxId: 'card',
        label: 'Status card',
        primitive: 'panel',
        tone: 'surface',
        x: 1,
        y: 1,
        width: 6,
        height: 3,
        active: true,
        focused: true,
        hovered: true
      }
    ]);
    expect(stableContainmentId('api', ['root', 'children', 0])).toBe('api:root/children/0');
    expect(assetIdForSrc('/status.gltf')).toBe('asset:gltf:/status.gltf');
    expect(royalCapabilityBoundaryContract.appMayUseRendererHandles).toBe(false);
    expectTypeOf(renderRows.rows).toEqualTypeOf<readonly RoyalRenderRow[]>();
  });
});

function createApiStores(): RoyalLensStores {
  const documentState: RoyalDocumentState = {
    scopeId: 'api',
    root: {
      label: 'root',
      tone: 'surface',
      children: [
        {
          id: 'card',
          label: 'Status card',
          primitive: 'panel',
          tone: 'surface',
          gltf: {
            src: '/status.gltf'
          }
        }
      ]
    }
  };
  const layoutState: RoyalLayoutRuntimeState = {
    scopeId: 'api',
    compact: false,
    grid: { columns: 12, rows: 8 },
    boxes: [
      {
        id: 'card',
        x: 1,
        y: 1,
        width: 6,
        height: 3,
        label: 'Status card',
        primitive: 'panel',
        tone: 'surface',
        gltf: {
          src: '/status.gltf'
        }
      }
    ],
    pickTargets: [
      {
        id: 'card',
        bounds: {
          rect: { x: 1, y: 1, width: 6, height: 3 },
          space: 'grid'
        },
        interaction: {
          label: 'Status card',
          role: 'button'
        },
        kind: 'box',
        label: 'Status card',
        layer: 1
      }
    ]
  };
  const interactionState: RoyalInteractionState = {
    scopeId: 'api',
    activeId: 'card',
    activationCount: 1,
    focusedId: undefined,
    hoveredId: 'card',
    geometryFailures: [],
    geometryStatus: 'ready',
    pointerSamples: [
      {
        sampleId: 'pointer-card',
        sequence: 1,
        kind: 'move',
        x: 2,
        y: 2,
        targetId: 'card'
      }
    ]
  };

  return {
    documentStore: readableStore(documentState),
    layoutStore: readableStore(layoutState),
    interactionStore: readableStore(interactionState)
  };
}

function readableStore<State>(state: State): RoyalReadableStore<State> {
  return {
    getState: () => state
  };
}
