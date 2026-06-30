import { describe, expect, expectTypeOf, it } from 'vitest';
import * as reactRoyal from '@royal/react';
import { jsx } from '@royal/react/jsx-runtime';
import {
  Canvas,
  createRoot,
  useFrame,
  type CanvasProps,
  type RoyalRoot,
  type RoyalRootOptions
} from '@royal/react';
import {
  boxGeometry,
  createSvgGatewayGeometry,
  imageTexture,
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
  type ShapeTextResult,
  type TextLayout,
  type TextMesh,
  type TextOptions
} from '@royal/renderer-core';
import * as rendererCoreSvg from '@royal/renderer-core/svg';
import type { SvgGatewayGeometry as RendererCoreSvgGeometry } from '@royal/renderer-core/svg';
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
import * as rendererWebgl from '@royal/renderer-webgl';
import * as tarstateLens from '@royal/tarstate-lens';
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
} from '@royal/tarstate-lens';

const researchOnlyRuntimeExportNamePattern =
  /^(?:customShaderMaterial|shaderUniform|shaderAttribute|DynamicImpostorNode|dynamicImpostor|VirtualTextureNode|VirtualTextureRuntime|LOD|Lod|lod|LODNode|LodNode|lodNode|LevelOfDetailNode|levelOfDetail|dynamicLod|lodLevel|lodRange|lodThreshold|lodDistance|lodPolicy|lodBias|lodBudget|FormControl|formControl|input|textarea|select|PageCache|pageCache|createPageCache|PageTable|pageTable|createPageTable|createVirtualTexturePageTableTexture|uploadVirtualTexturePageTableTexels|virtualTexturePageTableMipDimensions)$/;

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
    expect(typeof useFrame).toBe('function');
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

  it('keeps research-only feature names out of consumer runtime package exports', () => {
    const publicRuntimeModules = [
      { module: reactRoyal, specifier: '@royal/react' },
      { module: rendererCore, specifier: '@royal/renderer-core' },
      { module: rendererWebgl, specifier: '@royal/renderer-webgl' },
      { module: tarstateLens, specifier: '@royal/tarstate-lens' }
    ] as const;

    const leakedExports = publicRuntimeModules.flatMap(({ module, specifier }) =>
      Object.keys(module)
        .filter((name) => researchOnlyRuntimeExportNamePattern.test(name))
        .map((name) => `${specifier}.${name}`)
    );

    expect(leakedExports).toEqual([]);
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
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('vectorText');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('vectorTextMesh');
    expectTypeOf<typeof rendererCore>().not.toHaveProperty('textMeshFromLayout');
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
    const geometry = rendererCoreSvg.createSvgGatewayGeometry({
      height: 1,
      kind: 'rect',
      width: 2
    });
    const pathContours = rendererCoreSvg.svgPathToContours('M 0 0 L 2 0 L 2 1 Z');

    expect(rendererCoreText.shapeText).toBe(shapeText);
    expect(rendererCoreText.layoutText).toBe(layoutText);
    expect(rendererCoreText.textMesh).toBe(textMesh);
    expect(rendererCoreText).toHaveProperty('layoutEditableText');
    expect(rendererCoreSvg.createSvgGatewayGeometry).toBe(createSvgGatewayGeometry);
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
    expect(snapshot.probe.rows(royalLensSchema.assets)[0]).toMatchObject({
      assetId: 'asset:gltf:/status.gltf',
      src: '/status.gltf'
    });
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

  it('keeps public Tarstate lens v1 free of experimental terrain APIs', () => {
    expect(tarstateLens).not.toHaveProperty('experimentalTerrainQueries');
    expect(tarstateLens).not.toHaveProperty('writeExperimentalTerrainAvailability');
    expect(tarstateLens.royalLensSchema).not.toHaveProperty('terrainManifests');
    expect(tarstateLens.royalLensSchema).not.toHaveProperty('terrainTiles');
    expect(tarstateLens.royalLensSchema).not.toHaveProperty('terrainAssets');
    expect(tarstateLens.royalLensSchema).not.toHaveProperty('terrainAssetAvailability');
    expectTypeOf<typeof tarstateLens>().not.toHaveProperty('experimentalTerrainQueries');
    expectTypeOf<typeof tarstateLens>().not.toHaveProperty('writeExperimentalTerrainAvailability');
    expectTypeOf<typeof tarstateLens.royalLensSchema>().not.toHaveProperty('terrainManifests');
    expectTypeOf<RoyalLensStores>().not.toHaveProperty('terrainStore');
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
