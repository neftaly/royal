import { describe, expect, it } from 'vitest';
import {
  createRoyalLensSnapshot,
  createRoyalPatchDispatcher,
  evaluateRoyalLens,
  royalCapabilityBoundaryContract,
  royalLensSchema,
  royalQueries,
  writeRoyalActivation,
  writeRoyalEffectResult,
  experimentalTerrainQueries,
  writeExperimentalTerrainAvailability,
  type CapabilityRuntimeState,
  type RoyalDocumentState,
  type RoyalInteractionState,
  type RoyalLayoutRuntimeState,
  type RoyalLensStores,
  type RoyalTerrainOfflineState,
  type RoyalWritableStore
} from './v1.js';

type TestStores = RoyalLensStores & {
  readonly capabilityStore: RoyalWritableStore<CapabilityRuntimeState>;
  readonly documentStore: RoyalWritableStore<RoyalDocumentState>;
  readonly interactionStore: RoyalWritableStore<RoyalInteractionState>;
  readonly layoutStore: RoyalWritableStore<RoyalLayoutRuntimeState>;
  readonly terrainStore: RoyalWritableStore<RoyalTerrainOfflineState>;
};

describe('@royal/tarstate-lens/v1', () => {
  it('exposes a narrow query surface over app-owned stores', async () => {
    const stores = createStores();
    const snapshot = createRoyalLensSnapshot(stores);
    const renderRows = await evaluateRoyalLens(stores, royalQueries.renderRows);

    expect(Object.keys(royalQueries).sort()).toEqual([
      'capabilityResultRows',
      'pickProbeRows',
      'renderRows'
    ]);
    expect(Object.hasOwn(snapshot, 'state')).toBe(false);
    expect(snapshot.probe.rowCount(royalLensSchema.layoutBoxes)).toBe(1);
    expect(renderRows.diagnostics).toEqual([]);
    expect(renderRows.rows).toEqual([
      {
        scopeId: 'v1',
        boxId: 'button',
        label: 'Open fullscreen',
        primitive: 'button',
        tone: 'accent',
        x: 1,
        y: 1,
        width: 6,
        height: 2,
        active: false,
        focused: true,
        hovered: true
      }
    ]);
    expect(royalCapabilityBoundaryContract.appMayUseRendererHandles).toBe(false);
  });

  it('routes v1 writer helpers through private stores', async () => {
    const stores = createStores();
    const dispatcher = createRoyalPatchDispatcher({
      capabilityStore: stores.capabilityStore,
      interactionStore: stores.interactionStore
    });

    const result = dispatcher.dispatch([
      writeRoyalActivation({
        scopeId: 'v1',
        activeId: 'button',
        activationCount: 3,
        focusedId: 'button',
        hoveredId: 'button'
      }),
      writeRoyalEffectResult({
        scopeId: 'v1',
        resultId: 'result-fullscreen',
        intentId: 'intent-fullscreen',
        capabilityId: 'capability:fullscreen',
        resourceId: 'canvas:main',
        status: 'ok',
        sequence: 2
      })
    ]);
    const renderRows = await evaluateRoyalLens(stores, royalQueries.renderRows);
    const capabilityRows = await evaluateRoyalLens(stores, royalQueries.capabilityResultRows);

    expect(result).toEqual({ patches: 2, applied: 2, diagnostics: [] });
    expect(stores.interactionStore.getState()).toMatchObject({
      activeId: 'button',
      activationCount: 3,
      focusedId: 'button',
      hoveredId: 'button'
    });
    expect(stores.capabilityStore.getState().results).toEqual([
      {
        resultId: 'result-fullscreen',
        intentId: 'intent-fullscreen',
        capabilityId: 'capability:fullscreen',
        resourceId: 'canvas:main',
        status: 'ok',
        sequence: 2
      }
    ]);
    expect(renderRows.rows[0]).toMatchObject({
      active: true,
      focused: true,
      hovered: true
    });
    expect(capabilityRows.rows).toEqual([
      {
        scopeId: 'v1',
        resultId: 'result-fullscreen',
        intentId: 'intent-fullscreen',
        capabilityId: 'capability:fullscreen',
        resourceId: 'canvas:main',
        status: 'ok',
        message: undefined,
        diagnosticCode: undefined
      }
    ]);
  });

  it('queries experimental offline terrain rows and updates availability quality', async () => {
    const stores = createStores();
    const before = await evaluateRoyalLens(stores, experimentalTerrainQueries.offlineAssetRows);
    const dispatcher = createRoyalPatchDispatcher({
      terrainStore: stores.terrainStore
    });

    const result = dispatcher.dispatch([
      writeExperimentalTerrainAvailability({
        scopeId: 'v1',
        assetId: 'terrain:asset:root-height',
        available: true,
        status: 'resident',
        quality: 'full',
        qualityRank: 3,
        updatedSequence: 7,
        bytesCached: 4096
      })
    ]);
    const after = await evaluateRoyalLens(stores, experimentalTerrainQueries.offlineAssetRows);

    expect(before.diagnostics).toEqual([]);
    expect(before.rows).toEqual([
      {
        scopeId: 'v1',
        manifestId: 'terrain:manifest:alpine',
        datasetId: 'terrain:dataset:alpine',
        manifestUri: '/offline/terrain/alpine.manifest.json',
        version: '2026-06-29',
        tileId: 'terrain:tile:0/0/0',
        parentTileId: undefined,
        lod: 0,
        x: 0,
        y: 0,
        assetId: 'terrain:asset:root-height',
        assetKind: 'heightfield',
        assetUri: '/offline/terrain/alpine/0/0/0.height.ktx2',
        contentHash: 'sha256-height-root',
        byteLength: 4096,
        available: false,
        status: 'cached-preview',
        quality: 'preview',
        qualityRank: 1,
        updatedSequence: 1,
        bytesCached: 1024
      },
      {
        scopeId: 'v1',
        manifestId: 'terrain:manifest:alpine',
        datasetId: 'terrain:dataset:alpine',
        manifestUri: '/offline/terrain/alpine.manifest.json',
        version: '2026-06-29',
        tileId: 'terrain:tile:1/0/0',
        parentTileId: 'terrain:tile:0/0/0',
        lod: 1,
        x: 0,
        y: 0,
        assetId: 'terrain:asset:child-mesh',
        assetKind: 'mesh',
        assetUri: '/offline/terrain/alpine/1/0/0.mesh.glb',
        contentHash: 'sha256-mesh-child',
        byteLength: 8192,
        available: undefined,
        status: undefined,
        quality: undefined,
        qualityRank: undefined,
        updatedSequence: undefined,
        bytesCached: undefined
      }
    ]);
    expect(result).toEqual({ patches: 1, applied: 1, diagnostics: [] });
    expect(stores.terrainStore.getState().availability).toEqual([
      {
        assetId: 'terrain:asset:root-height',
        available: true,
        status: 'resident',
        quality: 'full',
        qualityRank: 3,
        updatedSequence: 7,
        bytesCached: 4096
      }
    ]);
    expect(after.rows[0]).toMatchObject({
      assetId: 'terrain:asset:root-height',
      available: true,
      status: 'resident',
      quality: 'full',
      qualityRank: 3,
      updatedSequence: 7,
      bytesCached: 4096
    });
  });
});

function createStores(): TestStores {
  const documentState: RoyalDocumentState = {
    scopeId: 'v1',
    root: {
      label: 'root',
      tone: 'surface',
      children: [
        {
          id: 'button',
          label: 'Open fullscreen',
          primitive: 'button',
          tone: 'accent'
        }
      ]
    }
  };
  const layoutState: RoyalLayoutRuntimeState = {
    scopeId: 'v1',
    compact: false,
    grid: { columns: 12, rows: 8 },
    boxes: [
      {
        id: 'button',
        x: 1,
        y: 1,
        width: 6,
        height: 2,
        interaction: {
          label: 'Open fullscreen',
          role: 'button'
        },
        label: 'Open fullscreen',
        primitive: 'button',
        tone: 'accent'
      }
    ],
    pickTargets: [
      {
        id: 'button',
        bounds: {
          rect: { x: 1, y: 1, width: 6, height: 2 },
          space: 'grid'
        },
        interaction: {
          label: 'Open fullscreen',
          role: 'button'
        },
        kind: 'box',
        label: 'Open fullscreen',
        layer: 1
      }
    ]
  };
  const interactionState: RoyalInteractionState = {
    scopeId: 'v1',
    activeId: undefined,
    activationCount: 0,
    focusedId: 'button',
    geometryFailures: [],
    geometryStatus: 'ready',
    hoveredId: 'button',
    pointerSamples: []
  };
  const capabilityState: CapabilityRuntimeState = {
    scopeId: 'v1',
    diagnostics: [],
    intents: [
      {
        intentId: 'intent-fullscreen',
        capabilityId: 'capability:fullscreen',
        kind: 'request_fullscreen',
        resourceId: 'canvas:main',
        payloadKind: 'fullscreen-request',
        sequence: 1
      }
    ],
    results: []
  };
  const terrainState: RoyalTerrainOfflineState = {
    scopeId: 'v1',
    manifests: [
      {
        manifestId: 'terrain:manifest:alpine',
        datasetId: 'terrain:dataset:alpine',
        uri: '/offline/terrain/alpine.manifest.json',
        version: '2026-06-29',
        rootTileId: 'terrain:tile:0/0/0',
        minLod: 0,
        maxLod: 1
      }
    ],
    tiles: [
      {
        tileId: 'terrain:tile:0/0/0',
        manifestId: 'terrain:manifest:alpine',
        lod: 0,
        x: 0,
        y: 0
      },
      {
        tileId: 'terrain:tile:1/0/0',
        manifestId: 'terrain:manifest:alpine',
        parentTileId: 'terrain:tile:0/0/0',
        lod: 1,
        x: 0,
        y: 0
      }
    ],
    assets: [
      {
        assetId: 'terrain:asset:root-height',
        manifestId: 'terrain:manifest:alpine',
        tileId: 'terrain:tile:0/0/0',
        kind: 'heightfield',
        uri: '/offline/terrain/alpine/0/0/0.height.ktx2',
        contentHash: 'sha256-height-root',
        byteLength: 4096
      },
      {
        assetId: 'terrain:asset:child-mesh',
        manifestId: 'terrain:manifest:alpine',
        tileId: 'terrain:tile:1/0/0',
        kind: 'mesh',
        uri: '/offline/terrain/alpine/1/0/0.mesh.glb',
        contentHash: 'sha256-mesh-child',
        byteLength: 8192
      }
    ],
    availability: [
      {
        assetId: 'terrain:asset:root-height',
        available: false,
        status: 'cached-preview',
        quality: 'preview',
        qualityRank: 1,
        updatedSequence: 1,
        bytesCached: 1024
      }
    ]
  };

  return {
    capabilityStore: writableStore(capabilityState),
    documentStore: writableStore(documentState),
    interactionStore: writableStore(interactionState),
    layoutStore: writableStore(layoutState),
    terrainStore: writableStore(terrainState)
  };
}

function writableStore<State>(initialState: State): RoyalWritableStore<State> {
  let state = initialState;

  return {
    getState: () => state,
    setState: (updater) => {
      state = typeof updater === 'function' ? (updater as (previous: State) => State)(state) : updater;
    }
  };
}
