import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  Canvas,
  boxGeometry,
  createRoot,
  mesh,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  text as reactText,
  type CanvasProps,
  type ReactRoyalRoot,
  type ReactRoyalRootOptions,
  type RenderRoot,
  type TextNode as ReactTextNode
} from '@royal/react';
import {
  collectRendererCapabilityRows,
  orthographic,
  type RendererCapabilityProbeResult
} from '@royal/react/testing';
import {
  layoutText,
  shapeText,
  text,
  textMesh,
  textMeshFromLayout,
  vectorTextGlyphRects,
  vectorTextMesh,
  type ShapeTextResult,
  type TextLayout,
  type TextMesh,
  type TextNode,
  type VectorTextRect
} from '@royal/renderer-core';
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
  it('lets consumers build a render root through the @royal/react facade', () => {
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
    const textNode = reactText({
      color: [1, 1, 1, 1],
      text: 'api'
    });

    expect(typeof Canvas).toBe('function');
    expect(root.children[0]?.children).toHaveLength(1);
    expect(textNode.glyphs.map((glyph) => glyph.char).join('')).toBe('api');
    expectTypeOf<CanvasProps>().toMatchTypeOf<{ readonly children: unknown }>();
    expectTypeOf(createRoot).toEqualTypeOf<(
      canvas: HTMLCanvasElement,
      options?: ReactRoyalRootOptions
    ) => ReactRoyalRoot>();
    expectTypeOf<ReactRoyalRoot>().toMatchTypeOf<{
      readonly dispose: () => void;
      readonly unmount: () => void;
    }>();
    expectTypeOf(root).toEqualTypeOf<RenderRoot>();
    expectTypeOf(textNode).toEqualTypeOf<ReactTextNode>();
  });

  it('exposes renderer-core text shaping, layout, and mesh helpers from the public entrypoint', () => {
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
    const legacyRects = vectorTextGlyphRects(textNode);

    expect(shaped.run.glyphs[1]?.kerning?.pair).toEqual(['glyph:A', 'glyph:V']);
    expect(layout.lines).toHaveLength(2);
    expect(meshFromLayout.vertices.length).toBeGreaterThan(0);
    expect(textMesh(layout)).toEqual(meshFromLayout);
    expect(meshFromNode.indices.length).toBeGreaterThan(0);
    expect(vectorTextMesh(textNode)).toEqual(meshFromNode);
    expect(legacyRects.length).toBeGreaterThan(0);
    expectTypeOf(shaped).toEqualTypeOf<ShapeTextResult>();
    expectTypeOf(layout).toEqualTypeOf<TextLayout>();
    expectTypeOf(textNode).toEqualTypeOf<TextNode>();
    expectTypeOf(meshFromNode).toEqualTypeOf<TextMesh>();
    expectTypeOf(legacyRects).toEqualTypeOf<readonly VectorTextRect[]>();
  });

  it('exposes renderer testing helpers without package-internal imports', () => {
    const projection = orthographic(-1, 1, -1, 1, 0.1, 100);
    const result = collectRendererCapabilityRows(
      {
        getExtension: () => undefined,
        getSupportedExtensions: () => []
      },
      { includeMissingDiagnostics: true }
    );

    expect(projection).toHaveLength(16);
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
